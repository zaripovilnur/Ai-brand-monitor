import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import express from 'express';
import { db, DB_PATH, listTables } from './db.js';
import { chat, GatewayError, BASE_URL, keyInfo } from './aitunnel.js';
import { SEED_MODELS, SEED_JUDGE_MODEL, SEED_MAX_TOKENS } from './seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

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
    max_tokens: SEED_MAX_TOKENS,
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

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (health: /api/health)`);
});
