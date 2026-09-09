import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import express from 'express';
import { db, DB_PATH, listTables } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const app = express();
app.use(express.json({ limit: '2mb' }));

// Ключ наружу не отдаётся никогда — только последние 4 символа отдельным полем.
function keyInfo() {
  const key = (process.env.AITUNNEL_API_KEY || '').trim();
  return {
    key_configured: key.length > 0,
    key_last4: key.length >= 4 ? key.slice(-4) : null,
  };
}

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
    ...keyInfo(),
  });
});

app.listen(PORT, () => {
  console.log(`[server] http://localhost:${PORT}  (health: /api/health)`);
});
