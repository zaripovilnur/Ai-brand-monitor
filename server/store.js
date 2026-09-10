import { db } from './db.js';
import { SEED_BRAND, SEED_FACTS, RAW_PROMPTS } from './seed.js';
import { classifyText } from './classify.js';

// Хранение бренда, фактов и запросов. Алиасы лежат ровно той строкой,
// которую набрал пользователь: по ней ищется упоминание и определяется
// брендовость запроса, поэтому «причёсывать» её нельзя.

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function rowToBrand(row) {
  return {
    id: row.id,
    name: row.name,
    aliases: row.aliases,
    competitors: parseJson(row.competitors, []),
  };
}

export function getBrand() {
  const row = db.prepare('SELECT * FROM brands ORDER BY id LIMIT 1').get();
  return row ? rowToBrand(row) : null;
}

export function saveBrand({ name, aliases, competitors }) {
  const brand = getBrand();
  db.prepare('UPDATE brands SET name = ?, aliases = ?, competitors = ? WHERE id = ?').run(
    String(name ?? brand.name),
    String(aliases ?? brand.aliases),
    JSON.stringify(Array.isArray(competitors) ? competitors : brand.competitors),
    brand.id
  );
  return getBrand();
}

export function listFacts() {
  const brand = getBrand();
  return db.prepare('SELECT id, text FROM facts WHERE brand_id = ? ORDER BY id').all(brand.id);
}

export function addFact(text) {
  const brand = getBrand();
  const info = db.prepare('INSERT INTO facts (brand_id, text) VALUES (?, ?)').run(brand.id, String(text).trim());
  return db.prepare('SELECT id, text FROM facts WHERE id = ?').get(info.lastInsertRowid);
}

export function deleteFact(id) {
  return db.prepare('DELETE FROM facts WHERE id = ?').run(Number(id)).changes > 0;
}

function rowToPrompt(row) {
  return {
    id: row.id,
    text: row.text,
    cat: row.category,
    auto: row.category_auto === 1,
    active: row.active === 1,
  };
}

export function listPrompts() {
  const brand = getBrand();
  return db.prepare('SELECT * FROM prompts WHERE brand_id = ? ORDER BY id').all(brand.id).map(rowToPrompt);
}

/**
 * Добавление запросов списком. Повтор с тем же текстом не добавляется —
 * как в прототипе, сверка без учёта регистра.
 */
export function addPrompts(texts) {
  const brand = getBrand();
  const aliases = brand.aliases;
  const existing = new Set(listPrompts().map((p) => p.text.toLowerCase()));

  const insert = db.prepare(
    'INSERT INTO prompts (brand_id, text, category, category_auto, active, version) VALUES (?, ?, ?, 1, 1, 1)'
  );

  const added = [];
  const run = db.transaction((list) => {
    for (const raw of list) {
      const text = String(raw || '').trim();
      if (!text || existing.has(text.toLowerCase())) continue;
      existing.add(text.toLowerCase());
      const info = insert.run(brand.id, text, classifyText(text, aliases));
      added.push(Number(info.lastInsertRowid));
    }
  });
  run(texts);

  return listPrompts().filter((p) => added.includes(p.id));
}

/**
 * Правка запроса. Смена категории вручную снимает пометку «авто».
 * Категория сама не пересчитывается при смене алиасов — как в прототипе.
 */
export function updatePrompt(id, { category, active }) {
  const fields = [];
  const values = [];
  if (category !== undefined) {
    fields.push('category = ?', 'category_auto = 0');
    values.push(String(category));
  }
  if (active !== undefined) {
    fields.push('active = ?');
    values.push(active ? 1 : 0);
  }
  if (!fields.length) return null;
  values.push(Number(id));
  db.prepare(`UPDATE prompts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = db.prepare('SELECT * FROM prompts WHERE id = ?').get(Number(id));
  return row ? rowToPrompt(row) : null;
}

export function deletePrompt(id) {
  return db.prepare('DELETE FROM prompts WHERE id = ?').run(Number(id)).changes > 0;
}

/**
 * Первый запуск: наполняем базу стартовыми значениями из прототипа.
 * Если бренд уже есть, ничего не трогаем.
 */
export function seedIfEmpty() {
  if (getBrand()) return false;

  const fill = db.transaction(() => {
    const info = db
      .prepare('INSERT INTO brands (name, aliases, competitors) VALUES (?, ?, ?)')
      .run(SEED_BRAND.name, SEED_BRAND.aliases, JSON.stringify(SEED_BRAND.competitors));
    const brandId = Number(info.lastInsertRowid);

    const fact = db.prepare('INSERT INTO facts (brand_id, text) VALUES (?, ?)');
    for (const f of SEED_FACTS) fact.run(brandId, f.text);

    const prompt = db.prepare(
      'INSERT INTO prompts (brand_id, text, category, category_auto, active, version) VALUES (?, ?, ?, 1, 1, 1)'
    );
    for (const text of RAW_PROMPTS) prompt.run(brandId, text, classifyText(text, SEED_BRAND.aliases));
  });
  fill();
  return true;
}
