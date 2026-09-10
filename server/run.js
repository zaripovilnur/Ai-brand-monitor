import { db } from './db.js';
import { chat, GatewayError, gap } from './aitunnel.js';
import { judgeAnswer } from './judge.js';
import { markMention, markPosition } from './marking.js';
import { getBrand, listFacts, listPrompts } from './store.js';
import { getSettings, currentJudgePrompt } from './settings.js';

// Прогон: долгая операция. Идёт в фоне, состояние живёт в базе,
// поэтому его видно из любого запроса и он переживает перезапуск.

const running = new Set(); // какие прогоны уже крутятся в этом процессе

export function activeRun() {
  return db.prepare("SELECT id FROM runs WHERE status = 'running' ORDER BY id LIMIT 1").get() || null;
}

export function createRun({ models, repeats }) {
  // Два прогона разом удвоили бы нагрузку на шлюз и расход денег
  const busy = activeRun();
  if (busy) {
    const e = new Error('Прогон уже идёт. Дождитесь его окончания.');
    e.code = 'run_in_progress';
    e.runId = busy.id;
    throw e;
  }

  const brand = getBrand();
  const settings = getSettings();
  const judge = currentJudgePrompt();

  const chosen = (models || []).filter((id) => settings.models.some((m) => m.id === id));
  if (!chosen.length) throw new Error('Не выбрано ни одной модели.');

  const reps = Math.max(1, Math.min(5, Number(repeats) || 1));
  const active = listPrompts().filter((p) => p.active);
  if (!active.length) throw new Error('Нет ни одного включённого запроса.');

  const info = db
    .prepare(
      `INSERT INTO runs (brand_id, started_at, models, repeats, judge_model, judge_prompt_version, mode, cost_rub, status)
       VALUES (?, ?, ?, ?, ?, ?, 'parametric', 0, 'running')`
    )
    .run(
      brand.id,
      new Date().toISOString(),
      // Слепок настроек целиком: без него через три месяца не понять, откуда цифры
      JSON.stringify({
        selected: chosen,
        models: settings.models,
        maxTokens: settings.maxTokens,
        pinProvider: settings.pinProvider,
        fallback: settings.fallback,
        prompts: active.map((p) => ({ id: p.id, text: p.text, cat: p.cat })),
        brand: { name: brand.name, aliases: brand.aliases, competitors: brand.competitors },
      }),
      reps,
      settings.judgeModel,
      judge.version
    );

  return Number(info.lastInsertRowid);
}

/**
 * Размеченные ответы прогона в том виде, в каком их ждёт интерфейс.
 * Ответы с ошибкой не попадают: запрос не состоялся, и считать его
 * «упоминания нет» — значит занизить метрику.
 */
function rowsOf(runId, snapshot) {
  const catOf = new Map(snapshot.prompts.map((p) => [p.id, p.cat]));
  return db
    .prepare(
      `SELECT a.id, a.prompt_id, a.model, a.repeat, a.text,
              m.mention, m.position, m.accuracy, m.tone, m.strength,
              m.evidence, m.note, m.judge_error
         FROM answers a
         LEFT JOIN marks m ON m.answer_id = a.id
        WHERE a.run_id = ? AND a.error IS NULL
        ORDER BY a.id`
    )
    .all(runId)
    .map((r) => ({
      id: String(r.id),
      promptId: r.prompt_id,
      cat: catOf.get(r.prompt_id) || 'info',
      model: r.model,
      repeat: r.repeat,
      mention: r.mention,
      position: r.position,
      accuracy: r.accuracy,
      tone: r.tone,
      strength: r.strength,
      evidence: r.evidence,
      note: r.note,
      judgeError: r.judge_error,
      text: r.text,
    }));
}

export function getRun(id, { withRows = false } = {}) {
  const row = db.prepare('SELECT * FROM runs WHERE id = ?').get(Number(id));
  if (!row) return null;
  const snapshot = JSON.parse(row.models);
  const planned = snapshot.prompts.length * snapshot.selected.length * row.repeats;
  const done = db.prepare('SELECT COUNT(*) AS n FROM answers WHERE run_id = ?').get(row.id).n;
  const failed = db.prepare("SELECT COUNT(*) AS n FROM answers WHERE run_id = ? AND error IS NOT NULL").get(row.id).n;
  const unmarked = db
    .prepare('SELECT COUNT(*) AS n FROM marks m JOIN answers a ON a.id = m.answer_id WHERE a.run_id = ? AND m.judge_error IS NOT NULL')
    .get(row.id).n;
  return {
    id: row.id,
    started_at: row.started_at,
    finished_at: row.finished_at,
    selected: snapshot.selected,
    // Интерфейс ждёт в models список выбранных моделей, как в прототипе
    models: snapshot.selected,
    modelList: snapshot.models,
    // Точные строки выбранных моделей: по ним видно подмену версии
    modelApis: snapshot.selected.map((id) => (snapshot.models.find((m) => m.id === id) || {}).api || id),
    repeats: row.repeats,
    judge_model: row.judge_model,
    judge_prompt_version: row.judge_prompt_version,
    cost_rub: row.cost_rub,
    status: row.status,
    planned,
    done,
    failed,
    unmarked,
    prompts: snapshot.prompts,
    brand: snapshot.brand,
    promptVer: row.judge_prompt_version,
    at: new Date(row.started_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' }),
    short: new Date(row.started_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }).replace('.', ''),
    ...(withRows ? { rows: rowsOf(row.id, snapshot) } : {}),
  };
}

export function listRuns(opts) {
  return db
    .prepare('SELECT id FROM runs ORDER BY id')
    .all()
    .map((r) => getRun(r.id, opts));
}

// Что ещё не сделано: сравниваем план со списком уже сохранённых ответов
function pending(runId) {
  const run = getRun(runId);
  const have = new Set(
    db
      .prepare('SELECT prompt_id, model, repeat FROM answers WHERE run_id = ?')
      .all(runId)
      .map((a) => `${a.prompt_id}|${a.model}|${a.repeat}`)
  );
  const todo = [];
  for (const p of run.prompts) {
    for (const modelId of run.selected) {
      for (let r = 1; r <= run.repeats; r++) {
        if (!have.has(`${p.id}|${modelId}|${r}`)) todo.push({ prompt: p, modelId, repeat: r });
      }
    }
  }
  return { run, todo };
}

function addCost(runId, rub) {
  if (!rub) return;
  db.prepare('UPDATE runs SET cost_rub = cost_rub + ? WHERE id = ?').run(rub, runId);
}

/**
 * Выполняет прогон до конца. Ошибка на одном ответе пишется в answers.error
 * и не роняет остальное. Повторный вызов доберёт недостающее.
 */
export async function execute(runId) {
  if (running.has(runId)) return;
  running.add(runId);
  try {
    const { run } = pending(runId);
    if (!run) return;
    db.prepare("UPDATE runs SET status = 'running' WHERE id = ?").run(runId);

    const settings = getSettings();
    const judgePrompt = db
      .prepare('SELECT text FROM judge_prompts WHERE version = ?')
      .get(run.judge_prompt_version);
    const facts = listFacts().map((f) => f.text);
    const apiOf = (id) => (run.modelList.find((m) => m.id === id) || {}).api;

    const insertAnswer = db.prepare(
      `INSERT INTO answers (run_id, prompt_id, model, repeat, raw_response, text, latency_ms, cost_rub, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const insertMark = db.prepare(
      `INSERT INTO marks (answer_id, mention, position, accuracy, tone, strength, evidence, note, judge_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    // Список задач берём заново на каждом шаге: настройки могли поменяться
    for (;;) {
      const { todo } = pending(runId);
      if (!todo.length) break;
      const job = todo[0];

      let answer = null;
      let failure = null;
      try {
        answer = await chat({
          model: apiOf(job.modelId),
          messages: [{ role: 'user', content: job.prompt.text }],
          maxTokens: settings.maxTokens,
        });
      } catch (e) {
        failure = e instanceof GatewayError ? e.message : String(e && e.message ? e.message : e);
      }

      const answerId = Number(
        insertAnswer.run(
          runId,
          job.prompt.id,
          job.modelId,
          job.repeat,
          answer ? JSON.stringify(answer.raw) : null,
          answer ? answer.text : null,
          answer ? answer.latency_ms : null,
          answer ? answer.cost_rub : null,
          failure
        ).lastInsertRowid
      );
      if (answer) addCost(runId, answer.cost_rub);

      if (answer) {
        // Метки: упоминание и позицию считает код, остальное — судья
        const mention = markMention(answer.text, run.brand.aliases);
        const position = markPosition(answer.text, run.brand.aliases, run.brand.competitors, job.prompt.cat);

        let judged = null;
        let judgeFailure = null;
        try {
          await gap();
          judged = await judgeAnswer({
            judgeModel: run.judge_model,
            judgePrompt: judgePrompt ? judgePrompt.text : undefined,
            maxTokens: settings.maxTokens,
            brand: run.brand.name,
            aliases: run.brand.aliases,
            competitors: run.brand.competitors,
            facts,
            prompt: job.prompt.text,
            answer: answer.text,
          });
        } catch (e) {
          judgeFailure = e instanceof GatewayError ? e.message : String(e && e.message ? e.message : e);
        }
        if (judged) addCost(runId, judged.cost_rub);

        const mark = judged && judged.mark;
        // На брендовых запросах сила рекомендации не считается: бренд назван
        // в самом вопросе, шкала вырождается
        const strength = job.prompt.cat === 'brand' ? null : mark ? mark.strength : null;
        insertMark.run(
          answerId,
          mention,
          position,
          mark ? mark.accuracy : null,
          mark ? mark.tone : null,
          strength,
          mark ? mark.evidence : null,
          mark ? mark.note : null,
          mark ? null : judgeFailure || (judged && judged.judge_error) || 'не размечено'
        );
      }

      await gap();
    }

    db.prepare("UPDATE runs SET status = 'done', finished_at = ? WHERE id = ?").run(new Date().toISOString(), runId);
  } catch (e) {
    console.error('[run]', e);
    db.prepare("UPDATE runs SET status = 'failed' WHERE id = ?").run(runId);
  } finally {
    running.delete(runId);
  }
}

/**
 * При старте сервера продолжаем прогоны, оборвавшиеся на середине.
 * Уже полученные ответы не перезапрашиваются — деньги второй раз не тратятся.
 */
export function resumeUnfinished() {
  const rows = db.prepare("SELECT id FROM runs WHERE status IN ('running', 'failed')").all();
  for (const r of rows) execute(r.id);
  return rows.length;
}
