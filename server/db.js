import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'app.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Схема из CLAUDE.md. Создаётся при старте, миграционных фреймворков нет.
db.exec(`
CREATE TABLE IF NOT EXISTS brands (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  aliases     TEXT NOT NULL DEFAULT '[]',
  competitors TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS facts (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  text     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id      INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  text          TEXT NOT NULL,
  category      TEXT NOT NULL,
  category_auto INTEGER NOT NULL DEFAULT 1,
  active        INTEGER NOT NULL DEFAULT 1,
  version       INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS runs (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  brand_id             INTEGER NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
  started_at           TEXT,
  finished_at          TEXT,
  models               TEXT NOT NULL DEFAULT '[]',
  repeats              INTEGER NOT NULL DEFAULT 1,
  judge_model          TEXT,
  judge_prompt_version INTEGER,
  mode                 TEXT NOT NULL DEFAULT 'parametric',
  cost_rub             REAL NOT NULL DEFAULT 0,
  status               TEXT NOT NULL DEFAULT 'queued'
);

CREATE TABLE IF NOT EXISTS answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id       INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  prompt_id    INTEGER NOT NULL REFERENCES prompts(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  repeat       INTEGER NOT NULL,
  raw_response TEXT,
  text         TEXT,
  latency_ms   INTEGER,
  cost_rub     REAL,
  error        TEXT
);

CREATE TABLE IF NOT EXISTS marks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  answer_id   INTEGER NOT NULL REFERENCES answers(id) ON DELETE CASCADE,
  mention     TEXT,
  position    TEXT,
  accuracy    TEXT,
  tone        TEXT,
  strength    TEXT,
  evidence    TEXT,
  note        TEXT,
  judge_error TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS judge_prompts (
  version    INTEGER PRIMARY KEY,
  text       TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_answers_run    ON answers(run_id);
CREATE INDEX IF NOT EXISTS idx_answers_prompt ON answers(prompt_id);
CREATE INDEX IF NOT EXISTS idx_marks_answer   ON marks(answer_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_slot ON answers(run_id, prompt_id, model, repeat);
CREATE INDEX IF NOT EXISTS idx_prompts_brand  ON prompts(brand_id);
CREATE INDEX IF NOT EXISTS idx_runs_brand     ON runs(brand_id);
`);

export const DB_PATH = DB_FILE;

export function listTables() {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
}
