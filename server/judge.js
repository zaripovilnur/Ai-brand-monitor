import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chat, GatewayError } from './aitunnel.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Стартовый текст промпта. Позже он переедет в базу и будет версионироваться.
export const DEFAULT_JUDGE_PROMPT = fs.readFileSync(path.join(__dirname, 'prompts', 'judge.txt'), 'utf8');
export const DEFAULT_JUDGE_PROMPT_VERSION = 1;

// Перечни значений — из прототипа (SCALE). Ничего вне их не принимается.
export const TONE = ['none', 'neutral', 'positive', 'negative', 'mixed'];
export const STRENGTH = ['mention', 'peer', 'strong', 'against'];
export const ACCURACY = ['exact', 'partial', 'wrong'];
export const POSITION = ['first', 'middle', 'last'];

// Схема ответа судьи. position судья возвращает, потому что этого просит промпт,
// но в метрику идёт значение, посчитанное кодом, — судейское не используется.
export const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['tone', 'strength', 'accuracy', 'position', 'evidence', 'note'],
  properties: {
    tone: { type: ['string', 'null'], enum: [...TONE, null] },
    strength: { type: ['string', 'null'], enum: [...STRENGTH, null] },
    accuracy: { type: ['string', 'null'], enum: [...ACCURACY, null] },
    position: { type: ['string', 'null'], enum: [...POSITION, null] },
    evidence: { type: ['string', 'null'] },
    note: { type: ['string', 'null'] },
  },
};

export function fillPrompt(template, { brand, aliases, competitors, facts, prompt, answer }) {
  const values = {
    '{brand}': brand || '',
    '{aliases}': Array.isArray(aliases) ? aliases.join(', ') : String(aliases || ''),
    '{competitors}': Array.isArray(competitors) ? competitors.join(', ') : String(competitors || ''),
    '{facts}': Array.isArray(facts) ? facts.map((f) => (typeof f === 'string' ? f : f.text)).join('\n') : String(facts || ''),
    '{prompt}': prompt || '',
    '{answer}': answer || '',
  };
  let out = template;
  for (const [k, v] of Object.entries(values)) out = out.split(k).join(v);
  return out;
}

function inList(value, list) {
  return value === null || value === undefined || list.includes(value);
}

// Значение вне перечня или сломанный JSON — это не «нейтрально по умолчанию»,
// а причина повторить запрос и, если снова мимо, оставить «не размечено».
function validate(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return 'судья вернул не объект';
  if (!inList(parsed.tone, TONE)) return `тональность вне перечня: ${JSON.stringify(parsed.tone)}`;
  if (!inList(parsed.strength, STRENGTH)) return `сила рекомендации вне перечня: ${JSON.stringify(parsed.strength)}`;
  if (!inList(parsed.accuracy, ACCURACY)) return `точность вне перечня: ${JSON.stringify(parsed.accuracy)}`;
  if (!inList(parsed.position, POSITION)) return `позиция вне перечня: ${JSON.stringify(parsed.position)}`;
  return null;
}

/**
 * Разметка одного ответа судьёй.
 * Судья не получает название модели, давшей ответ, — иначе оценка будет смещённой.
 * Возвращает { mark, judge_error, attempts, cost_rub, latency_ms, ... }.
 */
export async function judgeAnswer({
  judgeModel,
  judgePrompt,
  maxTokens,
  brand,
  aliases,
  competitors,
  facts,
  prompt,
  answer,
}) {
  const filled = fillPrompt(judgePrompt || DEFAULT_JUDGE_PROMPT, { brand, aliases, competitors, facts, prompt, answer });

  let lastProblem = null;
  let cost = 0;
  let latency = 0;
  let attempts = 0;
  let lastRaw = null;

  // Один повтор при сломанном ответе, затем «не размечено»
  for (let attempt = 0; attempt < 2; attempt++) {
    attempts++;
    let res;
    try {
      res = await chat({
        model: judgeModel,
        messages: [{ role: 'user', content: filled }],
        maxTokens,
        temperature: 0,
        responseFormat: {
          type: 'json_schema',
          json_schema: { name: 'brand_mark', strict: true, schema: JUDGE_SCHEMA },
        },
      });
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      throw e;
    }

    latency += res.latency_ms;
    if (typeof res.cost_rub === 'number') cost += res.cost_rub;
    lastRaw = res.raw;

    let parsed = null;
    try {
      parsed = JSON.parse(res.text);
    } catch {
      lastProblem = 'судья вернул сломанный JSON';
      continue;
    }

    const problem = validate(parsed);
    if (problem) {
      lastProblem = problem;
      continue;
    }

    return {
      mark: {
        tone: parsed.tone ?? null,
        strength: parsed.strength ?? null,
        accuracy: parsed.accuracy ?? null,
        evidence: parsed.evidence ?? null,
        note: parsed.note ?? null,
      },
      judge_position_ignored: parsed.position ?? null,
      judge_error: null,
      attempts,
      cost_rub: cost,
      latency_ms: latency,
      raw: lastRaw,
      judge_model: judgeModel,
    };
  }

  return {
    mark: null, // «не размечено» — значение по умолчанию не подставляется
    judge_position_ignored: null,
    judge_error: lastProblem || 'не размечено',
    attempts,
    cost_rub: cost,
    latency_ms: latency,
    raw: lastRaw,
    judge_model: judgeModel,
  };
}
