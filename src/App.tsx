import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Интерфейс перенесён из prototype/ai-brand-monitor.jsx.
// Вёрстка, цвета, шрифты и тексты — как в прототипе. Отличие одно:
// данные приходят из /api/*, а не из состояния React.

const T = {
  bg: "#FBFBFA",
  surface: "#FFFFFF",
  ink: "#17171A",
  muted: "#6B6B72",
  faint: "#9A9A9F",
  rule: "#E7E7E2",
  accent: "#3D3BD6",
  accentSoft: "#EFEFFC",
  pos: "#2E7D5B",
  neg: "#B4433A",
  warn: "#96702A",
};

const SANS = 'ui-sans-serif, system-ui, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SERIF = 'ui-serif, Georgia, "Times New Roman", serif';

const CATS: Record<string, string> = { brand: "Брендовый", category: "Категорийный", competitive: "Конкурентный", info: "Информационный" };

const SCALE = {
  position: [
    { k: "first", label: "Первым", c: "#3D3BD6" },
    { k: "middle", label: "В середине", c: "#8583E2" },
    { k: "last", label: "В конце", c: "#C9C8F1" },
  ],
  accuracy: [
    { k: "exact", label: "Точно", c: "#3D3BD6" },
    { k: "partial", label: "Частично точно", c: "#C9C8F1" },
    { k: "wrong", label: "Неверно", c: "#B4433A" },
  ],
  tone: [
    { k: "positive", label: "Позитивная", c: "#2E7D5B" },
    { k: "mixed", label: "Смешанная", c: "#C9922E" },
    { k: "neutral", label: "Нейтральная", c: "#A8A8AE" },
    { k: "negative", label: "Негативная", c: "#B4433A" },
    { k: "none", label: "Без оценки", c: "#E7E7E2" },
  ],
  strength: [
    { k: "strong", label: "Явно рекомендует", c: "#3D3BD6" },
    { k: "peer", label: "Советует наравне", c: "#8583E2" },
    { k: "mention", label: "Просто упоминает", c: "#C9C8F1" },
    { k: "against", label: "Не рекомендует", c: "#B4433A" },
  ],
};

const CAT_COLOR: Record<string, string> = { brand: "#3D3BD6", category: "#2E7D5B", competitive: "#C4643A", info: "#8C8C93" };

function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const pl = (n: number, one: string, few: string, many: string) => `${n} ${plural(n, one, few, many)}`;

type Brand = { id: number; name: string; aliases: string; competitors: string[] };
type Fact = { id: number; text: string };
type Prompt = { id: number; text: string; cat: string; auto: boolean; active: boolean };

type PromptsProps = {
  prompts: Prompt[];
  onAdd: (texts: string[]) => void;
  onUpdate: (id: number, patch: { category?: string; active?: boolean }) => void;
  onDelete: (id: number) => void;
};
type BtnProps = {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  small?: boolean;
  disabled?: boolean;
};
type FactsProps = { facts: Fact[]; onAdd: (text: string) => void; onDelete: (id: number) => void };
type BrandSetupProps = { brand: Brand; setBrand: (next: Brand) => void };
type ScaleBlockProps = {
  title: string;
  question: string;
  scale: { k: string; label: string; c: string }[];
  base: string;
  skip?: string;
};

async function req(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(await r.text());
  return r.status === 204 ? null : r.json();
}
const send = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

function Dot({ cat }: { cat: string }) {
  const c = CAT_COLOR[cat] || T.faint;
  return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: c, marginRight: 8, verticalAlign: "middle" }} />;
}

function Btn({ children, onClick, primary, small, disabled }: BtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        font: `${small ? 13 : 14}px ${SANS}`,
        padding: small ? "6px 12px" : "9px 16px",
        borderRadius: 6,
        cursor: disabled ? "not-allowed" : "pointer",
        border: primary ? "1px solid transparent" : `1px solid ${T.rule}`,
        background: primary ? (disabled ? "#B9B9E8" : T.accent) : T.surface,
        color: primary ? "#fff" : T.ink,
      }}
    >
      {children}
    </button>
  );
}

function Prompts({ prompts, onAdd, onUpdate, onDelete }: PromptsProps) {
  const [draft, setDraft] = useState("");
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState("");

  // Повторы отсекает и категорию проставляет сервер
  function add(list: string[]) {
    onAdd(list);
  }

  const counts: Record<string, number> = {};
  prompts.forEach((p) => (counts[p.cat] = (counts[p.cat] || 0) + 1));

  return (
    <div>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 6px" }}>Запросы</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 20px", maxWidth: "70ch" }}>
        Категория определяется автоматически по тексту. Помеченные «авто» можно переопределить — классификатор ошибается на формулировках без явных маркеров.
      </p>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: 22, fontSize: 13, color: T.muted }}>
        {Object.entries(CATS).map(([k, v]) => (
          <span key={k}>
            <Dot cat={k} />
            {v} · {counts[k] || 0}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && draft.trim()) { add([draft]); setDraft(""); } }} placeholder="Добавить запрос" style={{ flex: "1 1 320px" }} />
        <Btn onClick={() => { if (draft.trim()) { add([draft]); setDraft(""); } }}>Добавить</Btn>
        <Btn onClick={() => setBulk(!bulk)}>Импорт списком</Btn>
      </div>

      {bulk && (
        <div style={{ background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <p style={{ fontSize: 13, color: T.muted, margin: "0 0 10px" }}>Один запрос в строке. Категории проставятся сами.</p>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} style={{ width: "100%", resize: "vertical" }} placeholder={"Какие российские компании производят коммутаторы?\nНедостатки оборудования YADRO"} />
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <Btn primary small onClick={() => { add(text.split("\n")); setText(""); setBulk(false); }}>Загрузить</Btn>
            <Btn small onClick={() => setBulk(false)}>Отмена</Btn>
          </div>
        </div>
      )}

      <table style={{ fontSize: 14, background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10 }}>
        <tbody>
          {prompts.map((p, i) => (
            <tr key={p.id} style={{ borderTop: i ? `1px solid ${T.rule}` : "none" }}>
              <td style={{ padding: "12px 16px", width: 34 }}>
                <input type="checkbox" checked={p.active} onChange={() => onUpdate(p.id, { active: !p.active })} style={{ padding: 0 }} />
              </td>
              <td style={{ padding: "12px 0", color: p.active ? T.ink : T.faint }}>{p.text}</td>
              <td style={{ padding: "12px 16px", width: 196, textAlign: "right" }}>
                <select value={p.cat} onChange={(e) => onUpdate(p.id, { category: e.target.value })} style={{ fontSize: 13, padding: "5px 8px" }}>
                  {Object.entries(CATS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: T.faint, marginLeft: 8 }}>{p.auto ? "авто" : "вручную"}</span>
              </td>
              <td style={{ padding: "12px 16px", width: 40 }}>
                <button onClick={() => onDelete(p.id)} style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, fontSize: 16 }} aria-label="Удалить запрос">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Facts({ facts, onAdd, onDelete }: FactsProps) {
  const [draft, setDraft] = useState("");
  const push = () => {
    if (!draft.trim()) return;
    onAdd(draft.trim());
    setDraft("");
  };
  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 6px" }}>База фактов</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px", maxWidth: "70ch" }}>
        С этим списком сверяется точность. Без него оценка невозможна — судья будет угадывать правдоподобность вместо проверки.
      </p>

      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && push()} placeholder="Утверждение, которое считается верным" style={{ flex: "1 1 340px" }} />
        <Btn onClick={push}>Добавить</Btn>
      </div>

      <table style={{ fontSize: 14, background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10 }}>
        <tbody>
          {facts.map((f, i) => (
            <tr key={f.id} style={{ borderTop: i ? `1px solid ${T.rule}` : "none" }}>
              <td style={{ padding: "12px 16px" }}>{f.text}</td>
              <td style={{ padding: "12px 16px", width: 40 }}>
                <button onClick={() => onDelete(f.id)} style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, fontSize: 16 }} aria-label="Удалить факт">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 13, color: T.faint, marginTop: 14 }}>Для устойчивой оценки нужно 20–30 утверждений. Сейчас {pl(facts.length, "утверждение", "утверждения", "утверждений")}.</p>
    </div>
  );
}

function BrandSetup({ brand, setBrand }: BrandSetupProps) {
  const [comp, setComp] = useState("");
  const addComp = () => {
    const v = comp.trim();
    if (!v || brand.competitors.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setComp("");
      return;
    }
    setBrand({ ...brand, competitors: [...brand.competitors, v] });
    setComp("");
  };
  return (
    <div style={{ maxWidth: 600 }}>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 6px" }}>Бренд</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 28px", maxWidth: "64ch" }}>
        Алиасы ловят упоминание в любом написании. По ним же запрос определяется как брендовый.
      </p>

      {([["Название", "name"], ["Алиасы через запятую", "aliases"]] as [string, "name" | "aliases"][]).map(([label, key]) => (
        <div key={key} style={{ marginBottom: 20 }}>
          <label style={{ display: "block", fontSize: 13, color: T.muted, marginBottom: 6 }}>{label}</label>
          <input value={brand[key]} onChange={(e) => setBrand({ ...brand, [key]: e.target.value })} style={{ width: "100%" }} />
        </div>
      ))}

      <label style={{ display: "block", fontSize: 13, color: T.muted, marginBottom: 8 }}>Конкуренты</label>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        {brand.competitors.map((c) => (
          <span key={c} style={{ fontSize: 13, background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 20, padding: "5px 8px 5px 12px", display: "flex", alignItems: "center", gap: 6 }}>
            {c}
            <button onClick={() => setBrand({ ...brand, competitors: brand.competitors.filter((x) => x !== c) })} style={{ border: "none", background: "none", cursor: "pointer", color: T.faint }} aria-label={`Убрать ${c}`}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 10 }}>
        <input value={comp} onChange={(e) => setComp(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addComp()} placeholder="Добавить конкурента" style={{ flex: "1 1 200px" }} />
        <Btn onClick={addComp}>Добавить</Btn>
      </div>
    </div>
  );
}

const WHEN: Record<string, string> = {
  first: "бренд назван раньше всех остальных",
  middle: "бренд в середине перечня",
  last: "бренд назван последним или в самом конце",
  exact: "все утверждения о компании соответствуют базе фактов",
  partial: "утверждения верны, но описание неполно или размыто",
  wrong: "есть утверждение, противоречащее базе фактов, либо приписан чужой профиль или несуществующий продукт",
  positive: "оценка бренда в ответе положительная",
  neutral: "модель оценивает бренд, но без окраски",
  negative: "оценка отрицательная",
  mixed: "в одном ответе есть и плюсы, и минусы",
  none: "бренд назван, но никак не оценён — просто строка в перечне",
  mention: "бренд просто перечислен наряду с другими",
  peer: "бренд среди рекомендуемых, но не выделен",
  strong: "модель выделяет бренд как предпочтительный вариант",
  against: "модель прямо советует бренд не брать",
};

function ScaleBlock({ title, question, scale, base, skip }: ScaleBlockProps) {
  return (
    <div style={{ borderTop: `1px solid ${T.rule}`, padding: "22px 0" }}>
      <h3 style={{ font: `400 16px ${SANS}`, margin: "0 0 4px" }}>{title}</h3>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 16px", maxWidth: "70ch" }}>{question}</p>
      {scale.map((s) => (
        <div key={s.k} style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: s.c, flex: "0 0 9px", marginTop: 6 }} />
          <span style={{ fontSize: 14, flex: "0 0 175px" }}>{s.label}</span>
          <span style={{ fontSize: 14, color: T.muted, flex: 1, maxWidth: "60ch", lineHeight: 1.5 }}>{WHEN[s.k]}</span>
        </div>
      ))}
      <p style={{ fontSize: 13, color: T.faint, margin: "16px 0 0", maxWidth: "70ch", lineHeight: 1.6 }}>
        Знаменатель — {base}
        {skip ? ` · Не считается: ${skip}` : ""}
      </p>
    </div>
  );
}

function Method() {
  return (
    <div style={{ maxWidth: 820 }}>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 8px" }}>Как считаются метрики</h1>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 36px", lineHeight: 1.7, maxWidth: "70ch" }}>
        Каждый ответ модели получает набор меток. Метки ставит отдельная модель-судья по фиксированным правилам — она не участвует в замере и не знает, какая модель дала ответ. Цифры на дашборде это доли меток, не усреднённые баллы.
      </p>

      <h2 style={{ font: `400 18px ${SANS}`, margin: "0 0 14px" }}>Что происходит при прогоне</h2>
      <ol style={{ fontSize: 14, lineHeight: 1.8, color: T.ink, paddingLeft: 20, margin: "0 0 12px", maxWidth: "70ch" }}>
        <li>Каждый активный запрос отправляется в каждую выбранную модель.</li>
        <li>Запрос повторяется несколько раз — модели отвечают по-разному на один и тот же вопрос, и один ответ это шум, а не замер.</li>
        <li>Веб-поиск выключен. Модель отвечает из того, что усвоила при обучении, поэтому результат отражает её знание о бренде, а не сегодняшнюю выдачу.</li>
        <li>Каждый ответ сохраняется целиком и размечается судьёй.</li>
      </ol>
      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 36px", maxWidth: "70ch", lineHeight: 1.6 }}>
        Сравнивать между собой можно только прогоны с одинаковыми настройками. Смена набора запросов, числа повторов, версии модели или промпта судьи разрывает тренд. Поэтому версии моделей зафиксированы и не обновляются автоматически: если бы шлюз подставил свежую сборку сам, скачок метрики было бы не отличить от реального изменения.
      </p>

      <h2 style={{ font: `400 18px ${SANS}`, margin: "0 0 8px" }}>Категории запросов</h2>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 16px", maxWidth: "70ch" }}>
        Категория определяется по тексту запроса, правила проверяются сверху вниз. Любую можно переопределить вручную.
      </p>
      <table style={{ fontSize: 14, marginBottom: 12, tableLayout: "fixed" }}>
        <colgroup>
          <col style={{ width: 190 }} />
          <col />
          <col style={{ width: 250 }} />
        </colgroup>
        <tbody>
          {[
            ["brand", "В запросе есть название бренда или его алиас", "Какие продукты выпускает YADRO?"],
            ["competitive", "Есть маркер замещения: заменить, альтернатива, вместо, аналог", "Чем заменить иностранное оборудование?"],
            ["category", "Есть маркер подборки: какие компании, производители, лучшие, подходят", "Какие российские компании производят серверы?"],
            ["info", "Ни одного из маркеров выше", "Как выбрать сервер для компании?"],
          ].map(([k, rule, ex]) => (
            <tr key={k} style={{ borderTop: `1px solid ${T.rule}` }}>
              <td style={{ padding: "14px 20px 14px 0", verticalAlign: "top" }}>
                <span style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap" }}>
                  <Dot cat={k} />
                  {CATS[k]}
                </span>
              </td>
              <td style={{ padding: "14px 20px 14px 0", color: T.muted, verticalAlign: "top", lineHeight: 1.5 }}>{rule}</td>
              <td style={{ padding: "14px 0", color: T.faint, verticalAlign: "top", lineHeight: 1.5 }}>{ex}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 40px", maxWidth: "70ch", lineHeight: 1.6 }}>
        Брендовые запросы считаются отдельным блоком. В них бренд назван в самом вопросе, поэтому факт упоминания, позиция и сила рекомендации вырождаются и не показываются — модель обязана говорить о компании, о которой её спросили.
      </p>

      <h2 style={{ font: `400 18px ${SANS}`, margin: "0 0 4px" }}>Метрики</h2>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 6px", maxWidth: "70ch" }}>
        У каждой метрики свой знаменатель. Это важно: 42% упоминаний и 83% точности посчитаны от разного числа ответов и напрямую не сравниваются.
      </p>

      <div style={{ borderTop: `1px solid ${T.rule}`, padding: "22px 0" }}>
        <h3 style={{ font: `400 16px ${SANS}`, margin: "0 0 4px" }}>Факт упоминания</h3>
        <p style={{ fontSize: 14, color: T.muted, margin: "0 0 16px", maxWidth: "70ch" }}>Назван бренд в ответе или нет.</p>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 8 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: T.accent, flex: "0 0 9px", marginTop: 6 }} />
          <span style={{ fontSize: 14, flex: "0 0 175px" }}>Есть</span>
          <span style={{ fontSize: 14, color: T.muted, flex: 1 }}>найдено совпадение с названием или одним из алиасов</span>
        </div>
        <div style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "#E7E7E2", flex: "0 0 9px", marginTop: 6 }} />
          <span style={{ fontSize: 14, flex: "0 0 175px" }}>Нет</span>
          <span style={{ fontSize: 14, color: T.muted, flex: 1 }}>совпадений не найдено</span>
        </div>
        <p style={{ fontSize: 13, color: T.faint, margin: "16px 0 0", maxWidth: "70ch", lineHeight: 1.6 }}>
          Знаменатель — все ответы прогона · Ищется по списку алиасов, поэтому его полнота напрямую влияет на метрику
        </p>
      </div>

      <ScaleBlock
        title="Позиция"
        question="Где бренд стоит среди других названных компаний."
        scale={SCALE.position}
        base="ответы с упоминанием бренда"
        skip="брендовые запросы"
      />
      <ScaleBlock
        title="Точность"
        question="Верно ли модель описывает компанию и продукт. Проверяется по базе фактов — без неё судья угадывает правдоподобность вместо проверки."
        scale={SCALE.accuracy}
        base="упоминания, где есть проверяемое утверждение о компании"
        skip="ответы, где бренд только перечислен без описания"
      />
      <ScaleBlock
        title="Тональность"
        question="Как модель отзывается о бренде."
        scale={SCALE.tone}
        base="ответы с упоминанием бренда"
      />
      <ScaleBlock
        title="Сила рекомендации"
        question="Модель просто называет бренд или советует его. Шкала не усредняется: «не рекомендует» это не низший балл, а противоположное направление, поэтому показывается распределение."
        scale={SCALE.strength}
        base="ответы с упоминанием бренда"
        skip="брендовые запросы"
      />

      <h2 style={{ font: `400 18px ${SANS}`, margin: "40px 0 14px" }}>Чего эти цифры не показывают</h2>
      <ul style={{ fontSize: 14, lineHeight: 1.8, color: T.muted, paddingLeft: 20, margin: 0, maxWidth: "70ch" }}>
        <li>
          <span style={{ color: T.ink }}>Ответ через API отличается от того, что видит пользователь в приложении модели.</span> Там свой системный промпт, поиск и память. Мы измеряем близкий прокси, а не буквальный пользовательский опыт — расхождение с личной проверкой нормально.
        </li>
        <li>
          <span style={{ color: T.ink }}>Источники не собираются.</span> Без веб-поиска модель не на что ссылаться, а ссылки, которые она выдаёт по запросу, ведут в никуда. Поэтому в отчёте их нет.
        </li>
        <li>
          <span style={{ color: T.ink }}>Малая выборка даёт шум.</span> При трёх запросах в категории недельные колебания метрики могут доходить до 18 пунктов без каких-либо изменений в реальности. Рабочий минимум — 10–15 запросов на категорию.
        </li>
        <li>
          <span style={{ color: T.ink }}>Разметку ставит модель, а не человек.</span> Тональность, точность и силу рекомендации определяет модель-судья по фиксированным правилам. На крайних значениях она надёжна, на границе «просто упоминает» и «советует наравне» — ошибается. Для каждой оценки в разборе показан фрагмент, на котором она основана.
        </li>
      </ul>
    </div>
  );
}

export default function App() {
  const [tab, setTab] = useState("dash");
  const [brand, setBrandState] = useState<Brand | null>(null);
  const [facts, setFacts] = useState<Fact[]>([]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  // Прогоны появятся на шаге 5
  const runs: { at: string }[] = [];
  const run = runs.length ? runs[runs.length - 1] : null;
  const saveTimer = useRef<number | null>(null);

  useEffect(() => {
    req("/api/brand").then(setBrandState).catch(console.error);
    req("/api/facts").then(setFacts).catch(console.error);
    req("/api/prompts").then(setPrompts).catch(console.error);
  }, []);

  // Бренд правится вживую, как в прототипе; на сервер уходит, когда набор затих
  function setBrand(next: Brand) {
    setBrandState(next);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      req("/api/brand", send("PUT", { name: next.name, aliases: next.aliases, competitors: next.competitors })).catch(
        console.error
      );
    }, 400);
  }

  const addPrompts = (texts: string[]) =>
    req("/api/prompts", send("POST", { texts }))
      .then((fresh: Prompt[]) => setPrompts((prev) => [...prev, ...fresh]))
      .catch(console.error);

  const updatePrompt = (id: number, patch: { category?: string; active?: boolean }) =>
    req(`/api/prompts/${id}`, send("PATCH", patch))
      .then((next: Prompt) => setPrompts((prev) => prev.map((p) => (p.id === id ? next : p))))
      .catch(console.error);

  const deletePrompt = (id: number) =>
    req(`/api/prompts/${id}`, { method: "DELETE" })
      .then(() => setPrompts((prev) => prev.filter((p) => p.id !== id)))
      .catch(console.error);

  const addFact = (text: string) =>
    req("/api/facts", send("POST", { text }))
      .then((fact: Fact) => setFacts((prev) => [...prev, fact]))
      .catch(console.error);

  const deleteFact = (id: number) =>
    req(`/api/facts/${id}`, { method: "DELETE" })
      .then(() => setFacts((prev) => prev.filter((f) => f.id !== id)))
      .catch(console.error);

  const nav = [
    { group: "Отчёт", items: [["dash", "Дашборд"], ["answers", "Ответы"]] },
    { group: "Настройка", items: [["prompts", "Запросы"], ["facts", "База фактов"], ["brand", "Бренд"]] },
  ];

  if (!brand) return null;

  return (
    <div className="shell" style={{ background: T.bg, minHeight: "100vh", fontFamily: SANS, color: T.ink }}>
      <style>{`
        *:focus-visible { outline: 2px solid ${T.accent}; outline-offset: 2px; }
        input, select, textarea { font-family: ${SANS}; font-size: 14px; color: ${T.ink}; background: ${T.surface};
          border: 1px solid ${T.rule}; border-radius: 6px; padding: 8px 10px; }
        table { border-collapse: collapse; width: 100%; }
        .shell { display: flex; align-items: stretch; }
        .side { flex: 0 0 224px; width: 224px; background: ${T.surface}; border-right: 1px solid ${T.rule};
          padding: 26px 14px; position: sticky; top: 0; align-self: flex-start; height: 100vh; display: flex; flex-direction: column; }
        .navgroup { font-size: 11px; color: ${T.faint}; padding: 0 12px; margin: 18px 0 6px; }
        .navbtn { display: block; width: 100%; text-align: left; border: none; background: none; cursor: pointer;
          font-family: inherit; font-size: 14px; padding: 8px 12px; border-radius: 6px; color: ${T.muted}; margin-bottom: 2px; }
        .navbtn:hover { background: #F4F4F1; color: ${T.ink}; }
        .navbtn.on { background: ${T.accentSoft}; color: ${T.accent}; }
        .chip { border: 1px solid ${T.rule}; background: ${T.surface}; color: ${T.muted}; font-family: inherit;
          font-size: 13px; padding: 6px 12px; border-radius: 20px; cursor: pointer; margin-right: 8px; margin-bottom: 8px; }
        .chip.on { border-color: ${T.accent}; color: ${T.accent}; background: ${T.accentSoft}; }
        .body { flex: 1; min-width: 0; padding: 36px 40px 80px; }
        @media (max-width: 860px) {
          .shell { display: block; }
          .side { width: auto; height: auto; position: static; flex: none; border-right: none;
            border-bottom: 1px solid ${T.rule}; padding: 16px 20px; }
          .navlist { display: flex; flex-wrap: wrap; gap: 4px; }
          .navgroup { display: none; }
          .navbtn { width: auto; margin: 0; }
          .body { padding: 26px 20px 60px; }
        }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
      `}</style>

      <aside className="side">
        <div style={{ padding: "0 12px", marginBottom: 6 }}>
          <div style={{ fontSize: 15, fontWeight: 500 }}>{brand.name}</div>
          <div style={{ fontSize: 12, color: T.faint, marginTop: 2 }}>мониторинг в ИИ</div>
        </div>
        <div className="navlist">
          {nav.map((g) => (
            <div key={g.group}>
              <div className="navgroup">{g.group}</div>
              {g.items.map(([id, label]) => (
                <button key={id} className={"navbtn" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
                  {label}
                </button>
              ))}
            </div>
          ))}
          <button className={"navbtn" + (tab === "run" ? " on" : "")} onClick={() => setTab("run")} style={{ marginTop: 20 }}>
            Новый прогон
          </button>
          <button className={"navbtn" + (tab === "method" ? " on" : "")} onClick={() => setTab("method")}>
            Как считаем
          </button>
        </div>
        <div style={{ marginTop: "auto", padding: "16px 12px 0", borderTop: `1px solid ${T.rule}`, fontSize: 12, color: T.faint, lineHeight: 1.6 }}>
          {run ? `${pl(runs.length, "прогон", "прогона", "прогонов")} · последний ${runs[runs.length - 1].at}` : "Прогонов пока нет"}
        </div>
      </aside>

      <main className="body" style={{ maxWidth: 1120 }}>
        {/* Дашборд, Ответы и Новый прогон появятся на шагах 5 и 6 */}
        {tab === "prompts" && (
          <Prompts prompts={prompts} onAdd={addPrompts} onUpdate={updatePrompt} onDelete={deletePrompt} />
        )}
        {tab === "facts" && <Facts facts={facts} onAdd={addFact} onDelete={deleteFact} />}
        {tab === "method" && <Method />}
        {tab === "brand" && <BrandSetup brand={brand} setBrand={setBrand} />}
      </main>
    </div>
  );
}
