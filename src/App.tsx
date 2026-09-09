import { useEffect, useState } from 'react';

// ВРЕМЕННАЯ страница шага 1. Нужна только чтобы убедиться, что фронт видит бэкенд
// и что база создалась. Будет полностью заменена интерфейсом из прототипа.

type Health = {
  ok: boolean;
  time: string;
  db: { ok: boolean; path: string; tables: string[]; error: string | null };
  key_configured: boolean;
  key_last4: string | null;
};

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch((e) => setError(String(e)));
  }, []);

  return (
    <main style={{ fontFamily: 'monospace', padding: 24, lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 16 }}>Проверка связки (шаг 1)</h1>
      {error && <p>Бэкенд не отвечает: {error}</p>}
      {!error && !health && <p>Проверяю…</p>}
      {health && (
        <ul>
          <li>Бэкенд отвечает: да</li>
          <li>База данных: {health.db.ok ? 'создана' : 'ошибка'} ({health.db.path})</li>
          <li>Таблицы: {health.db.tables.join(', ')}</li>
          <li>
            Ключ AITunnel:{' '}
            {health.key_configured ? `задан, оканчивается на ${health.key_last4}` : 'не задан в .env'}
          </li>
        </ul>
      )}
    </main>
  );
}
