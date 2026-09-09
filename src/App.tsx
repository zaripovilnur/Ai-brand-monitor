import { useEffect, useState } from 'react';

// ВРЕМЕННЫЙ технический экран шагов 1–3. Нужен только чтобы проверить,
// что бэкенд жив, база создалась и ключ AITunnel работает.
// Интерфейс из прототипа появится на шагах 4 и 6 и заменит этот экран целиком.

type Health = {
  ok: boolean;
  db: { ok: boolean; path: string; tables: string[]; error: string | null };
  base_url: string;
  models: { id: string; name: string; api: string }[];
  judge_model: string;
  judge_prompt_version: number;
  max_tokens: number;
  brand: { name: string; aliases: string; competitors: string[] };
  facts: { id: string; text: string }[];
  key_configured: boolean;
  key_last4: string | null;
};

type TestOk = {
  ok: true;
  model_requested: string;
  model_returned: string | null;
  text: string;
  latency_ms: number;
  cost_rub: number | null;
  finish_reason: string | null;
  usage: Record<string, unknown> | null;
};

type TestFail = { ok: false; error: string; code?: string; status?: number | null };

type JudgeOk = {
  ok: true;
  category: string;
  by_code: { mention: string; position: string | null };
  by_judge: { tone: string | null; strength: string | null; accuracy: string | null; evidence: string | null; note: string | null } | null;
  judge_error: string | null;
  judge_position_ignored: string | null;
  judge_model: string;
  judge_prompt_version: number;
  attempts: number;
  cost_rub: number | null;
  latency_ms: number;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Что такое YADRO и чем занимается компания?');
  const [maxTokens, setMaxTokens] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestOk | null>(null);
  const [failure, setFailure] = useState<TestFail | null>(null);

  const [judgeModel, setJudgeModel] = useState('');
  const [judgeQuestion, setJudgeQuestion] = useState('Какие российские компании производят серверы для бизнеса?');
  const [judgeText, setJudgeText] = useState(
    'В первую очередь стоит смотреть на YADRO: компания закрывает и серверное направление, и хранение данных, с собственным производством и долгой поддержкой. Также рассматривают Аквариус и Депо.'
  );
  const [judgeBusy, setJudgeBusy] = useState(false);
  const [judgeResult, setJudgeResult] = useState<JudgeOk | null>(null);
  const [judgeFailure, setJudgeFailure] = useState<TestFail | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: Health) => {
        setHealth(h);
        setModel(h.models[0]?.api || '');
        setJudgeModel(h.judge_model);
        setMaxTokens(h.max_tokens);
      })
      .catch((e) => setHealthError(String(e)));
  }, []);

  async function send() {
    setBusy(true);
    setResult(null);
    setFailure(null);
    try {
      const r = await fetch('/api/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt, max_tokens: maxTokens }),
      });
      const data = await r.json();
      if (data.ok) setResult(data as TestOk);
      else setFailure(data as TestFail);
    } catch (e) {
      setFailure({ ok: false, error: `Не удалось обратиться к бэкенду: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  }

  async function sendJudge() {
    setJudgeBusy(true);
    setJudgeResult(null);
    setJudgeFailure(null);
    try {
      const r = await fetch('/api/test-judge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: judgeText, prompt: judgeQuestion, judge_model: judgeModel }),
      });
      const data = await r.json();
      if (data.ok) setJudgeResult(data as JudgeOk);
      else setJudgeFailure(data as TestFail);
    } catch (e) {
      setJudgeFailure({ ok: false, error: `Не удалось обратиться к бэкенду: ${String(e)}` });
    } finally {
      setJudgeBusy(false);
    }
  }

  return (
    <main style={{ fontFamily: 'monospace', padding: 24, lineHeight: 1.6, maxWidth: 900 }}>
      <h1 style={{ fontSize: 16 }}>Техническая проверка (шаги 1–3). Не дизайн — будет заменено интерфейсом из прототипа.</h1>

      <h2 style={{ fontSize: 14 }}>1. Связка и база</h2>
      {healthError && <p>Бэкенд не отвечает: {healthError}</p>}
      {!healthError && !health && <p>Проверяю…</p>}
      {health && (
        <ul>
          <li>Бэкенд отвечает: да</li>
          <li>База данных: {health.db.ok ? 'создана' : 'ошибка'} ({health.db.path})</li>
          <li>Таблицы: {health.db.tables.join(', ')}</li>
          <li>Адрес шлюза: {health.base_url}</li>
          <li>
            Ключ AITunnel:{' '}
            {health.key_configured ? `задан, оканчивается на ${health.key_last4}` : 'не задан в .env'}
          </li>
        </ul>
      )}

      <h2 style={{ fontSize: 14, marginTop: 28 }}>2. Один запрос к одной модели</h2>
      {health && (
        <div>
          <p style={{ margin: '0 0 8px' }}>
            Модель:{' '}
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              style={{ fontFamily: 'monospace', width: 260 }}
            />
            {health.models.map((m) => (
              <button key={m.id} onClick={() => setModel(m.api)} style={{ marginLeft: 8, fontFamily: 'monospace' }}>
                {m.api}
              </button>
            ))}
          </p>
          <p style={{ margin: '0 0 8px' }}>
            Лимит токенов:{' '}
            <input
              type="number"
              value={maxTokens}
              min={100}
              step={100}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
              style={{ fontFamily: 'monospace', width: 100 }}
            />
          </p>
          <p style={{ margin: '0 0 8px' }}>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
          </p>
          <button onClick={send} disabled={busy || !model || !prompt.trim()} style={{ fontFamily: 'monospace' }}>
            {busy ? 'Отправляю…' : 'Отправить запрос'}
          </button>
        </div>
      )}

      {failure && (
        <div style={{ marginTop: 16 }}>
          <p>Ошибка: {failure.error}</p>
          {failure.code && <p>Код: {failure.code}{failure.status ? ` (HTTP ${failure.status})` : ''}</p>}
        </div>
      )}

      {result && (
        <div style={{ marginTop: 16 }}>
          <ul>
            <li>Запрошенная модель: {result.model_requested}</li>
            <li>Модель в ответе шлюза: {result.model_returned ?? 'не указана'}</li>
            {result.model_returned && result.model_returned !== result.model_requested && (
              <li>ВНИМАНИЕ: шлюз ответил другой моделью — замеры будут несравнимы</li>
            )}
            <li>Время ответа: {result.latency_ms} мс</li>
            <li>Стоимость: {result.cost_rub === null ? 'шлюз не вернул cost_rub' : `${result.cost_rub} ₽`}</li>
            <li>Причина остановки: {result.finish_reason ?? 'не указана'}</li>
          </ul>
          <pre style={{ whiteSpace: 'pre-wrap', background: '#f4f4f4', padding: 12 }}>{result.text}</pre>
        </div>
      )}

      <h2 style={{ fontSize: 14, marginTop: 28 }}>3. Разметка одного текста</h2>
      {health && (
        <div>
          <p style={{ margin: '0 0 8px' }}>
            Модель-судья:{' '}
            <input
              value={judgeModel}
              onChange={(e) => setJudgeModel(e.target.value)}
              style={{ fontFamily: 'monospace', width: 260 }}
            />{' '}
            промпт версии {health.judge_prompt_version}
          </p>
          <p style={{ margin: '0 0 4px' }}>Запрос, на который отвечала модель:</p>
          <p style={{ margin: '0 0 8px' }}>
            <input
              value={judgeQuestion}
              onChange={(e) => setJudgeQuestion(e.target.value)}
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
          </p>
          <p style={{ margin: '0 0 4px' }}>Текст ответа модели:</p>
          <p style={{ margin: '0 0 8px' }}>
            <textarea
              value={judgeText}
              onChange={(e) => setJudgeText(e.target.value)}
              rows={5}
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
          </p>
          <button
            onClick={sendJudge}
            disabled={judgeBusy || !judgeModel || !judgeText.trim() || !judgeQuestion.trim()}
            style={{ fontFamily: 'monospace' }}
          >
            {judgeBusy ? 'Размечаю…' : 'Разметить'}
          </button>
        </div>
      )}

      {judgeFailure && (
        <div style={{ marginTop: 16 }}>
          <p>Ошибка: {judgeFailure.error}</p>
          {judgeFailure.code && <p>Код: {judgeFailure.code}{judgeFailure.status ? ` (HTTP ${judgeFailure.status})` : ''}</p>}
        </div>
      )}

      {judgeResult && (
        <div style={{ marginTop: 16 }}>
          <p style={{ margin: '0 0 4px' }}>Считает код:</p>
          <ul style={{ marginTop: 0 }}>
            <li>Категория запроса: {judgeResult.category}</li>
            <li>Факт упоминания: {judgeResult.by_code.mention}</li>
            <li>Позиция: {judgeResult.by_code.position ?? 'не применима'}</li>
          </ul>
          <p style={{ margin: '0 0 4px' }}>Ставит судья:</p>
          {judgeResult.by_judge ? (
            <ul style={{ marginTop: 0 }}>
              <li>Точность: {judgeResult.by_judge.accuracy ?? 'null'}</li>
              <li>Тональность: {judgeResult.by_judge.tone ?? 'null'}</li>
              <li>Сила рекомендации: {judgeResult.by_judge.strength ?? 'null'}</li>
              <li>Фрагмент: {judgeResult.by_judge.evidence ?? 'null'}</li>
              <li>Пояснение: {judgeResult.by_judge.note ?? 'null'}</li>
            </ul>
          ) : (
            <ul style={{ marginTop: 0 }}>
              <li>не размечено — {judgeResult.judge_error}</li>
            </ul>
          )}
          <ul>
            <li>Позиция от судьи (не используется, считает код): {judgeResult.judge_position_ignored ?? 'null'}</li>
            <li>Попыток: {judgeResult.attempts}</li>
            <li>Время: {judgeResult.latency_ms} мс</li>
            <li>Стоимость: {judgeResult.cost_rub === null ? 'шлюз не вернул cost_rub' : `${judgeResult.cost_rub} ₽`}</li>
            <li>Судья: {judgeResult.judge_model}, промпт версии {judgeResult.judge_prompt_version}</li>
          </ul>
        </div>
      )}
    </main>
  );
}
