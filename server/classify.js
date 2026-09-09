import { parseAliases } from './marking.js';

// Автоклассификация запросов. Правила и списки маркеров — из прототипа,
// проверяются сверху вниз, любую категорию можно переопределить вручную.

const SWAP = ["замен", "альтернатив", "вместо", "импортозамещ", "аналог"];
const LIST = ["какие компании", "какие российские компании", "какие производители", "какие отечественные", "лучшие", "топ ", "подходят", "выпускают", "производят"];

export function classify(text, aliases) {
  const t = text.toLowerCase();
  if (aliases.some((a) => a && t.includes(a.toLowerCase()))) return "brand";
  if (SWAP.some((m) => t.includes(m))) return "competitive";
  if (LIST.some((m) => t.includes(m))) return "category";
  return "info";
}
export function classifyText(text, aliases) {
  return classify(text, parseAliases(aliases));
}
