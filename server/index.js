import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import express from 'express';
import { db, DB_PATH, listTables } from './db.js';
import { chat, GatewayError, BASE_URL, keyInfo } from './aitunnel.js';
import { SEED_MODELS, SEED_JUDGE_MODEL, SEED_MAX_TOKENS, SEED_BRAND, SEED_FACTS } from './seed.js';
import { markMention, markPosition, parseAliases } from './marking.js';
import { classifyText } from './classify.js';
import { judgeAnswer, DEFAULT_JUDGE_PROMPT, DEFAULT_JUDGE_PROMPT_VERSION } from './judge.js';
import {
  seedIfEmpty,
  getBrand,
  saveBrand,
  listFacts,
  addFact,
  deleteFact,
  listPrompts,
  addPrompts,
  updatePrompt,
  deletePrompt,
} from './store.js';
import { getSettings, saveSettings, currentJudgePrompt, saveJudgePrompt, seedSettingsIfEmpty } from './settings.js';
import { createRun, getRun, listRuns, execute, resumeUnfinished } from './run.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;
const CATEGORIES = ['brand', 'category', 'competitive', 'info'];

// Первый запуск: стартовые значения из прототипа
seedIfEmpty();
seedSettingsIfEmpty();
// Прогон, оборванный на середине, продолжается сам — без повторной оплаты
resumeUnfinished();

const app = express();
app.use(express.json({ limit: '2mb' }));

app.get('/api/health', (req, res) => {
  let dbOk = false;
  let tables = [];
  let dbError = null;
  try {
    db.prepare('SELECT 1').get();
    tables = listTables();
    dbOk = true;
  } catch (e) {
    dbError = String(e && e.message ? e.message : e);
  }
  res.json({
    ok: dbOk,
    time: new Date().toISOString(),
    db: { ok: dbOk, path: path.relative(path.resolve(__dirname, '..'), DB_PATH), tables, error: dbError },
    base_url: BASE_URL,
    models: SEED_MODELS,
    judge_model: SEED_JUDGE_MODEL,
    judge_prompt_version: DEFAULT_JUDGE_PROMPT_VERSION,
    max_tokens: SEED_MAX_TOKENS,
    brand: SEED_BRAND,
    facts: SEED_FACTS,
    ...keyInfo(), // только последние 4 символа, сам ключ в браузер не уходит
  });
});

// Шаг 2: один запрос к одной модели. Нужен, чтобы убедиться, что ключ работает.
app.post('/api/test-model', async (req, res) => {
  const { model, prompt, max_tokens } = req.body || {};
  const question = String(prompt || '').trim();
  if (!question) {
    return res.status(400).json({ ok: false, error: 'Не задан текст запроса.', code: 'no_prompt' });
  }
  try {
    const r = await chat({
      model,
      messages: [{ role: 'user', content: question }],
      maxTokens: max_tokens || SEED_MAX_TOKENS,
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    if (e instanceof GatewayError) {
      return res.status(e.code === 'no_key' || e.code === 'no_model' || e.code === 'auto_model' || e.code === 'floating_alias' || e.code === 'no_max_tokens' ? 400 : 502).json({
        ok: false,
        error: e.message,
        code: e.code,
        status: e.status,
      });
    }
    console.error('[test-model]', e);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера.', code: 'internal' });
  }
});

// Шаг 3: разметка одного вставленного вручную текста.
// Упоминание и позицию считает код, остальное — судья.
app.post('/api/test-judge', async (req, res) => {
  const body = req.body || {};
  const answer = String(body.text || '').trim();
  const question = String(body.prompt || '').trim();
  if (!answer) {
    return res.status(400).json({ ok: false, error: 'Не задан текст ответа модели.', code: 'no_text' });
  }
  if (!question) {
    return res.status(400).json({ ok: false, error: 'Не задан текст запроса, на который отвечала модель.', code: 'no_prompt' });
  }

  const brandName = String(body.brand || SEED_BRAND.name);
  const aliases = parseAliases(body.aliases !== undefined ? body.aliases : SEED_BRAND.aliases);
  const competitors = Array.isArray(body.competitors) ? body.competitors : SEED_BRAND.competitors;
  const facts = Array.isArray(body.facts) ? body.facts : SEED_FACTS.map((f) => f.text);

  const category = classifyText(question, aliases);
  const mention = markMention(answer, aliases);
  const position = markPosition(answer, aliases, competitors, category);

  try {
    const judged = await judgeAnswer({
      judgeModel: body.judge_model || SEED_JUDGE_MODEL,
      judgePrompt: DEFAULT_JUDGE_PROMPT,
      maxTokens: body.max_tokens || SEED_MAX_TOKENS,
      brand: brandName,
      aliases,
      competitors,
      facts,
      prompt: question,
      answer,
    });

    res.json({
      ok: true,
      category,
      by_code: { mention, position },
      by_judge: judged.mark,
      judge_error: judged.judge_error,
      judge_position_ignored: judged.judge_position_ignored,
      judge_model: judged.judge_model,
      judge_prompt_version: DEFAULT_JUDGE_PROMPT_VERSION,
      attempts: judged.attempts,
      cost_rub: judged.cost_rub,
      latency_ms: judged.latency_ms,
    });
  } catch (e) {
    if (e instanceof GatewayError) {
      const clientSide = ['no_key', 'no_model', 'auto_model', 'floating_alias', 'no_max_tokens'].includes(e.code);
      return res.status(clientSide ? 400 : 502).json({ ok: false, error: e.message, code: e.code, status: e.status });
    }
    console.error('[test-judge]', e);
    res.status(500).json({ ok: false, error: 'Внутренняя ошибка сервера.', code: 'internal' });
  }
});

// --- Бренд ---

app.get('/api/brand', (req, res) => {
  res.json(getBrand());
});

app.put('/api/brand', (req, res) => {
  const { name, aliases, competitors } = req.body || {};
  if (name !== undefined && !String(name).trim()) {
    return res.status(400).json({ error: 'Название бренда не может быть пустым.' });
  }
  res.json(saveBrand({ name, aliases, competitors }));
});

// --- Факты ---

app.get('/api/facts', (req, res) => {
  res.json(listFacts());
});

app.post('/api/facts', (req, res) => {
  const text = String((req.body || {}).text || '').trim();
  if (!text) return res.status(400).json({ error: 'Пустой факт добавить нельзя.' });
  res.status(201).json(addFact(text));
});

app.delete('/api/facts/:id', (req, res) => {
  if (!deleteFact(req.params.id)) return res.status(404).json({ error: 'Факт не найден.' });
  res.status(204).end();
});

// --- Запросы ---

app.get('/api/prompts', (req, res) => {
  res.json(listPrompts());
});

app.post('/api/prompts', (req, res) => {
  const body = req.body || {};
  const list = Array.isArray(body.texts) ? body.texts : [body.text];
  const cleaned = list.map((t) => String(t || '').trim()).filter(Boolean);
  if (!cleaned.length) return res.status(400).json({ error: 'Нечего добавлять.' });
  res.status(201).json(addPrompts(cleaned));
});

app.patch('/api/prompts/:id', (req, res) => {
  const { category, active } = req.body || {};
  if (category !== undefined && !CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Неизвестная категория.' });
  }
  const updated = updatePrompt(req.params.id, { category, active });
  if (!updated) return res.status(404).json({ error: 'Запрос не найден.' });
  res.json(updated);
});

app.delete('/api/prompts/:id', (req, res) => {
  if (!deletePrompt(req.params.id)) return res.status(404).json({ error: 'Запрос не найден.' });
  res.status(204).end();
});

// --- Подключение: настройки и промпт судьи ---

app.get('/api/settings', (req, res) => {
  const judge = currentJudgePrompt();
  res.json({
    ...getSettings(),
    judgePrompt: judge.text,
    judgePromptVersion: judge.version,
    defaultJudgePrompt: DEFAULT_JUDGE_PROMPT,
    ...keyInfo(), // ключ не отдаётся, только последние 4 знака
  });
});

app.put('/api/settings', (req, res) => {
  const patch = req.body || {};
  if (Array.isArray(patch.models)) {
    for (const m of patch.models) {
      const api = String(m.api || '').trim();
      if (!api) return res.status(400).json({ error: 'Строка модели не может быть пустой.' });
      if (api.toLowerCase() === 'auto') {
        return res.status(400).json({ error: 'Модель auto запрещена: замеры перестанут быть сравнимыми.' });
      }
    }
  }
  res.json(saveSettings(patch));
});

app.put('/api/judge-prompt', (req, res) => {
  try {
    res.json(saveJudgePrompt((req.body || {}).text));
  } catch (e) {
    res.status(400).json({ error: String(e.message || e) });
  }
});

// Кнопка «Проверить подключение»
app.post('/api/test-connection', async (req, res) => {
  const settings = getSettings();
  const model = (settings.models[0] || {}).api;
  try {
    const r = await chat({
      model,
      messages: [{ role: 'user', content: 'ping' }],
      maxTokens: 16,
    });
    res.json({ ok: true, model: r.model_returned || model });
  } catch (e) {
    res.status(e instanceof GatewayError && e.code === 'no_key' ? 400 : 502).json({
      ok: false,
      error: e instanceof GatewayError ? e.message : 'Не удалось связаться со шлюзом.',
    });
  }
});

// --- Прогоны ---

app.get('/api/runs', (req, res) => {
  res.json(listRuns());
});

app.post('/api/runs', (req, res) => {
  const { models, repeats } = req.body || {};
  if (!keyInfo().key_configured) {
    return res.status(400).json({ error: 'Ключ AITunnel не задан в .env — прогон невозможен.' });
  }
  let id;
  try {
    id = createRun({ models, repeats });
  } catch (e) {
    return res.status(400).json({ error: String(e.message || e) });
  }
  execute(id); // в фоне, ответ не ждём
  res.status(201).json(getRun(id));
});

app.get('/api/runs/:id', (req, res) => {
  const run = getRun(req.params.id);
  if (!run) return res.status(404).json({ error: 'Прогон не найден.' });
  res.json(run);
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (health: /api/health)`);
});
