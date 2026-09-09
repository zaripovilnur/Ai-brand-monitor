// Метки, которые ставит код, а не судья: факт упоминания и позиция.
// Поиск по алиасам — подстрокой без учёта регистра, как в прототипе.

export function parseAliases(aliases) {
  if (Array.isArray(aliases)) return aliases.map((s) => String(s).trim()).filter(Boolean);
  return String(aliases || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Первое вхождение любого из вариантов написания, -1 если нет
function firstIndex(haystack, needles) {
  let best = -1;
  for (const n of needles) {
    if (!n) continue;
    const i = haystack.indexOf(n.toLowerCase());
    if (i >= 0 && (best === -1 || i < best)) best = i;
  }
  return best;
}

/**
 * Факт упоминания: есть ли в ответе название бренда или любой его алиас.
 */
export function markMention(text, aliases) {
  return firstIndex(String(text || '').toLowerCase(), parseAliases(aliases)) >= 0 ? 'yes' : 'no';
}

/**
 * Позиция: где бренд стоит среди других названных компаний.
 * Сравниваются индексы первых вхождений бренда и конкурентов.
 * На брендовых запросах не считается — бренд назван в самом вопросе.
 */
export function markPosition(text, aliases, competitors, category) {
  if (category === 'brand') return null;

  const hay = String(text || '').toLowerCase();
  const brandAt = firstIndex(hay, parseAliases(aliases));
  if (brandAt < 0) return null;

  const others = (competitors || [])
    .map((c) => firstIndex(hay, [String(c)]))
    .filter((i) => i >= 0);

  if (!others.length) return 'first';
  const earlier = others.filter((i) => i < brandAt).length;
  if (earlier === 0) return 'first';
  if (earlier === others.length) return 'last';
  return 'middle';
}
