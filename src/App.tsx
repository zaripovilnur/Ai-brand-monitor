import { useEffect, useState } from 'react';

// ВРЕМЕННЫЙ технический экран шагов 1–2. Нужен только чтобы проверить,
// что бэкенд жив, база создалась и ключ AITunnel работает.
// Интерфейс из прототипа появится на шагах 4 и 6 и заменит этот экран целиком.

type Health = {
  ok: boolean;
  db: { ok: boolean; path: string; tables: string[]; error: string | null };
  base_url: string;
  models: { id: string; name: string; api: string }[];
  judge_model: string;
  max_tokens: number;
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

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);

  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('Что такое YADRO и чем занимается компания?');
  const [maxTokens, setMaxTokens] = useState(1500);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TestOk | null>(null);
  const [failure, setFailure] = useState<TestFail | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then((h: Health) => {
        setHealth(h);
        setModel(h.models[0]?.api || '');
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

  return (
    <main style={{ fontFamily: 'monospace', padding: 24, lineHeight: 1.6, maxWidth: 900 }}>
      <h1 style={{ fontSize: 16 }}>Техническая проверка (шаги 1–2). Не дизайн — будет заменено интерфейсом из прототипа.</h1>

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
    </main>
  );
}
