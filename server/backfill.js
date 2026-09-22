import { db } from './db.js';
import { sourcesOf } from './aitunnel.js';

// Дозаполнение архива. Фрагменты процитированных страниц шлюз присылал всегда,
// но раньше мы их не сохраняли. Сырые ответы лежат в базе целиком, фрагменты —
// внутри них, поэтому старые прогоны восстанавливаются разбором уже сохранённого
// JSON. К моделям не ходим, денег это не стоит.

export function backfillSourceContent() {
  const pending = db
    .prepare(
      `SELECT DISTINCT a.id, a.raw_response
         FROM sources s JOIN answers a ON a.id = s.answer_id
        WHERE s.content IS NULL AND a.raw_response IS NOT NULL`
    )
    .all();
  if (!pending.length) return { answers: 0, filled: 0 };

  const update = db.prepare('UPDATE sources SET content = ? WHERE answer_id = ? AND url = ? AND content IS NULL');
  let filled = 0;

  const run = db.transaction((rows) => {
    for (const row of rows) {
      let data;
      try {
        data = JSON.parse(row.raw_response);
      } catch {
        continue; // битый JSON пропускаем: чинить нечего, а прогон ронять незачем
      }
      const choice = (data.choices && data.choices[0]) || null;
      const message = (choice && choice.message) || null;
      for (const src of sourcesOf(message)) {
        if (!src.content) continue;
        filled += update.run(src.content, row.id, src.url).changes;
      }
    }
  });
  run(pending);

  return { answers: pending.length, filled };
}
