import { db } from './db.js';
import { SEED_MODELS, SEED_JUDGE_MODEL, SEED_MAX_TOKENS } from './seed.js';
import { DEFAULT_JUDGE_PROMPT } from './judge.js';
import { BASE_URL } from './aitunnel.js';

// Настройки прогона и версии промпта судьи. Строки моделей правятся
// на экране «Подключение», а не в коде.

const DEFAULTS = {
  provider: 'aitunnel',
  baseUrl: BASE_URL,
  models: SEED_MODELS,
  judgeModel: SEED_JUDGE_MODEL,
  maxTokens: SEED_MAX_TOKENS,
  pinProvider: true,
  fallback: false,
};

function readRaw(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

function writeRaw(key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    JSON.stringify(value)
  );
}

export function getSettings() {
  const out = { ...DEFAULTS };
  for (const key of Object.keys(DEFAULTS)) {
    const v = readRaw(key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

export function saveSettings(patch) {
  for (const key of Object.keys(DEFAULTS)) {
    if (patch[key] !== undefined) writeRaw(key, patch[key]);
  }
  return getSettings();
}

// --- промпт судьи ---

export function currentJudgePrompt() {
  const row = db.prepare('SELECT version, text FROM judge_prompts ORDER BY version DESC LIMIT 1').get();
  return row || { version: 1, text: DEFAULT_JUDGE_PROMPT };
}

/**
 * Сохранение промпта всегда поднимает версию: правка меняет правила оценки,
 * и без новой версии прогоны до и после были бы неотличимы.
 */
export function saveJudgePrompt(text) {
  const clean = String(text || '');
  if (!clean.trim()) throw new Error('Промпт не может быть пустым.');
  const next = currentJudgePrompt().version + 1;
  db.prepare('INSERT INTO judge_prompts (version, text, created_at) VALUES (?, ?, ?)').run(
    next,
    clean,
    new Date().toISOString()
  );
  return currentJudgePrompt();
}

export function seedSettingsIfEmpty() {
  if (!db.prepare('SELECT 1 FROM judge_prompts LIMIT 1').get()) {
    db.prepare('INSERT INTO judge_prompts (version, text, created_at) VALUES (1, ?, ?)').run(
      DEFAULT_JUDGE_PROMPT,
      new Date().toISOString()
    );
  }
  if (readRaw('models') === undefined) saveSettings(DEFAULTS);
}
