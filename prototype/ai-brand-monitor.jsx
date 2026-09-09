import React, { useState, useMemo, useEffect, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import * as XLSX from "xlsx";

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

const MODELS = [
  { id: "gpt", name: "ChatGPT", api: "gpt-5.6-sol" },
  { id: "gem", name: "Gemini", api: "gemini-3.7-flash" },
  { id: "cld", name: "Claude", api: "claude-sonnet-4.6" },
];

const CATS = { brand: "Брендовый", category: "Категорийный", competitive: "Конкурентный", info: "Информационный" };

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

const LBL = {};
Object.values(SCALE).forEach((arr) => arr.forEach((x) => (LBL[x.k] = x.label)));

const LINE = [
  { c: "#3D3BD6", dash: "0" },
  { c: "#C4643A", dash: "5 4" },
  { c: "#2E7D5B", dash: "2 3" },
];

const CAT_COLOR = { brand: "#3D3BD6", category: "#2E7D5B", competitive: "#C4643A", info: "#8C8C93" };

// Русские числительные: 1 ответ / 2 ответа / 5 ответов
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
const pl = (n, one, few, many) => `${n} ${plural(n, one, few, many)}`;

const escapeRe = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function pctOf(d, key) {
  const it = d.items.find((x) => x.k === key);
  return it ? Math.round(it.pct) : 0;
}

const DEFAULT_JUDGE_PROMPT = `Ты размечаешь ответы ИИ-моделей о компании. Оцени ТОЛЬКО отношение к бренду,
не к рынку и не к конкурентам. Верни строго JSON, без пояснений вокруг.

БРЕНД: {brand} (также: {aliases})
КОНКУРЕНТЫ: {competitors}
ФАКТЫ О КОМПАНИИ: {facts}
ВОПРОС: {prompt}
ОТВЕТ МОДЕЛИ: {answer}

tone — как о бренде отзываются:
  none — бренд назван, но не оценён (просто в перечне)
  neutral — оценка есть, без окраски
  positive / negative — оценка положительная / отрицательная
  mixed — есть и плюс, и минус про сам бренд

strength — что советуют сделать:
  mention — перечислен наряду с другими
  peer — среди рекомендуемых, но не выделен
  strong — есть маркер предпочтения («в первую очередь», «лучший выбор»)
  against — прямой совет не брать

accuracy — верно ли описана компания, сверять с ФАКТАМИ:
  exact — всё соответствует
  partial — верно, но неполно
  wrong — есть противоречие фактам или приписан чужой профиль

position — где бренд среди других названных компаний: first, middle, last

Оси независимы. Пример: «Хорошее оборудование, но под вашу задачу
возьмите другое» → tone: positive, strength: against.
Если бренд не упомянут — все поля null.

Формат ответа:
{"tone":"","strength":"","accuracy":"","position":"","evidence":"","note":""}
evidence — фрагмент ответа, на котором основана оценка
note — одно предложение, почему именно так`;

const SEED_API = {
  provider: "aitunnel",
  baseUrl: "https://api.aitunnel.ru/v1",
  key: "",
  judgeModel: "gemini-3.8-flash",
  maxTokens: 1500,
  pinProvider: true,
  fallback: false,
};

const SEED_BRAND = { name: "YADRO", aliases: "YADRO, ЯДРО, Yadro, yadro.com", competitors: ["Аквариус", "Депо", "Гравитон", "Инферит", "Fplus"] };

const SEED_FACTS = [
  { id: "f1", text: "Российский разработчик и производитель ИТ-оборудования" },
  { id: "f2", text: "Выпускает серверное оборудование для корпоративного сегмента" },
  { id: "f3", text: "Выпускает системы хранения данных" },
  { id: "f4", text: "Работает с крупным бизнесом, телекомом и госсектором" },
  { id: "f5", text: "Имеет собственное производство на территории России" },
];

const RAW_PROMPTS = [
  "Что такое YADRO и чем занимается компания?",
  "Какие продукты выпускает YADRO?",
  "Чем YADRO известна на рынке?",
  "Какие российские компании производят серверы для бизнеса?",
  "Какие компании в России выпускают оборудование для хранения данных?",
  "Какие отечественные производители помогают компаниям строить ИТ-инфраструктуру?",
  "Какие есть российские альтернативы зарубежным серверам?",
  "Чем заменить иностранное оборудование для хранения данных в компании?",
  "Какие российские компании могут заменить зарубежных поставщиков ИТ-оборудования?",
  "Как выбрать сервер для компании?",
  "На что обратить внимание при выборе оборудования для хранения данных?",
  "Какие российские производители ИТ-оборудования подходят для крупного бизнеса?",
];

const SWAP = ["замен", "альтернатив", "вместо", "импортозамещ", "аналог"];
const LIST = ["какие компании", "какие российские компании", "какие производители", "какие отечественные", "лучшие", "топ ", "подходят", "выпускают", "производят"];

function classify(text, aliases) {
  const t = text.toLowerCase();
  if (aliases.some((a) => a && t.includes(a.toLowerCase()))) return "brand";
  if (SWAP.some((m) => t.includes(m))) return "competitive";
  if (LIST.some((m) => t.includes(m))) return "category";
  return "info";
}

function rand(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function pick(v, opts) {
  let acc = 0;
  for (const [k, w] of opts) {
    acc += w;
    if (v < acc) return k;
  }
  return opts[opts.length - 1][0];
}

function compose(brand, comps, cat, row) {
  const list = comps.slice(0, 3).join(", ");
  if (cat === "brand") {
    if (row.mention === "no") return "Уверенной информации об организации с таким названием нет. Возможно, речь о компании, известной на локальном рынке.";
    if (row.accuracy === "wrong")
      return `${brand} — российская компания, разрабатывающая программное обеспечение и облачные сервисы для среднего бизнеса. Собственного производства и аппаратных линеек у неё нет.`;
    if (row.accuracy === "partial")
      return `${brand} — российская компания в сфере вычислительной техники. По имеющимся данным сосредоточена на серверном направлении; о других линейках и текущем составе производства сведений нет.`;
    return `${brand} — российский разработчик и производитель ИТ-оборудования: серверные системы и решения для хранения данных. Ориентирована на корпоративный сегмент, телеком и госсектор, имеет собственное производство в России.`;
  }
  if (row.mention === "no") return `На российском рынке этот сегмент закрывают ${list}. Выбор зависит от требуемой производительности, условий поставки и сервисной поддержки в регионе.`;
  if (row.accuracy === "wrong") return `Из российских вариантов обычно рассматривают ${comps[0]} и ${brand}. При этом ${brand} — сборочное подразделение зарубежного вендора, поэтому оборудование по сути импортное.`;
  if (row.strength === "against") return `Обычно рассматривают ${comps[0]} и ${comps[1]}. ${brand} для этой задачи брать не стоит — линейка ориентирована на другой класс нагрузок, а сроки поставки заметно длиннее.`;
  if (row.strength === "strong") return `В первую очередь стоит смотреть на ${brand}: компания закрывает и серверное направление, и хранение данных, с собственным производством и долгой поддержкой. Также рассматривают ${comps[0]} и ${comps[1]}.`;
  if (row.strength === "peer") return `Из российских вариантов обычно рассматривают ${comps[0]}, ${brand} и ${comps[1]}. ${brand} чаще выбирают там, где нужен корпоративный уровень.`;
  return `Российские производители: ${comps[0]}, ${comps[1]}, ${brand}, ${comps[2]}.`;
}

function runEngine(prompts, brand, comps, modelIds, repeats, salt, drift) {
  const rows = [];
  prompts.forEach((p) => {
    modelIds.forEach((md) => {
      for (let r = 0; r < repeats; r++) {
        const k = `${p.id}|${md}|${r}|${salt}`;
        const isBrand = p.cat === "brand";
        const catBonus = p.cat === "category" ? 0.16 : p.cat === "competitive" ? 0.04 : p.cat === "info" ? -0.16 : 0.62;
        const bias = md === "gpt" ? 0.07 : md === "gem" ? -0.06 : 0;
        const mention = rand(k) + catBonus + bias + drift * 0.02 > 0.5 ? "yes" : "no";

        const row = { id: k, promptId: p.id, cat: p.cat, model: md, repeat: r + 1, mention, position: null, accuracy: null, tone: "none", strength: null };

        if (mention === "yes") {
          if (!isBrand) {
            row.position = pick(rand(k + "p"), [["first", 0.2], ["middle", 0.5], ["last", 0.3]]);
            row.strength = pick(rand(k + "s"), [["strong", 0.16], ["peer", 0.34], ["mention", 0.44], ["against", 0.06]]);
            row.tone =
              row.strength === "against"
                ? "negative"
                : row.strength === "mention"
                ? pick(rand(k + "t"), [["none", 0.72], ["neutral", 0.22], ["mixed", 0.06]])
                : pick(rand(k + "t"), [["positive", 0.46], ["neutral", 0.28], ["mixed", 0.18], ["negative", 0.08]]);
            if (row.strength !== "mention") row.accuracy = pick(rand(k + "a"), [["exact", 0.78], ["partial", 0.17], ["wrong", 0.05]]);
          } else {
            row.accuracy = pick(rand(k + "a"), [["exact", 0.62], ["partial", 0.29], ["wrong", 0.09]]);
            row.tone = pick(rand(k + "t"), [["neutral", 0.44], ["positive", 0.34], ["mixed", 0.16], ["negative", 0.06]]);
          }
        }
        row.text = compose(brand, comps, p.cat, row);
        rows.push(row);
      }
    });
  });
  return rows;
}

function dist(rows, field, scale) {
  const counts = {};
  scale.forEach((s) => (counts[s.k] = 0));
  let base = 0;
  rows.forEach((r) => {
    if (r[field] && counts[r[field]] !== undefined) {
      counts[r[field]]++;
      base++;
    }
  });
  return { counts, base, items: scale.map((s) => ({ ...s, n: counts[s.k], pct: base ? (counts[s.k] / base) * 100 : 0 })) };
}

function agg(rows) {
  const n = rows.length;
  const men = rows.filter((r) => r.mention === "yes");
  return {
    n,
    men: men.length,
    mentionPct: n ? (men.length / n) * 100 : 0,
    position: dist(men, "position", SCALE.position),
    accuracy: dist(men, "accuracy", SCALE.accuracy),
    tone: dist(men, "tone", SCALE.tone),
    strength: dist(men, "strength", SCALE.strength),
    against: men.filter((r) => r.strength === "against").length,
    wrong: men.filter((r) => r.accuracy === "wrong").length,
  };
}

function Num({ value, suffix, size }) {
  return (
    <span style={{ fontFamily: SERIF, fontSize: size || 32, lineHeight: 1.05, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
      {value}
      {suffix ? <span style={{ fontSize: (size || 32) * 0.6, color: T.muted }}>{suffix}</span> : null}
    </span>
  );
}

function RunPicker({ run, runs, setRunId, note }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
      <select value={run.id} onChange={(e) => setRunId(e.target.value)} style={{ minWidth: 190 }}>
        {[...runs].reverse().map((r, i) => (
          <option key={r.id} value={r.id}>
            Прогон от {r.at}
            {i === 0 ? " — последний" : ""}
          </option>
        ))}
      </select>
      {note && <span style={{ fontSize: 12, color: T.warn, maxWidth: "56ch", lineHeight: 1.5 }}>{note}</span>}
    </div>
  );
}

function Kpi({ label, value, suffix, lead, base, size, alarm, first, delta }) {
  return (
    <div style={{ padding: first ? "0 20px 0 0" : "0 20px", flex: "1 1 168px", minWidth: 168, borderLeft: first ? "none" : `1px solid ${T.rule}` }}>
      <div style={{ fontSize: 13, color: T.muted, marginBottom: 8 }}>{label}</div>
      <Num value={value} suffix={suffix} size={size} />
      <div style={{ fontSize: 12, color: T.ink, marginTop: 8 }}>
        {lead}
        {delta !== undefined && delta !== null && (
          <span style={{ color: delta > 0 ? T.pos : delta < 0 ? T.neg : T.faint, marginLeft: 8 }}>
            {delta > 0 ? "+" : ""}
            {delta} п.п.
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, color: alarm ? T.neg : T.faint, marginTop: 2, lineHeight: 1.5 }}>{base}</div>
    </div>
  );
}

function Bars({ title, d, note }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8, gap: 12, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14 }}>{title}</span>
        <span style={{ fontSize: 12, color: T.faint }}>{note || `база ${d.base}`}</span>
      </div>
      <div style={{ display: "flex", height: 22, borderRadius: 4, overflow: "hidden", background: "#F2F2EF" }}>
        {d.items.map((it) =>
          it.n === 0 ? null : <div key={it.k} style={{ width: `${it.pct}%`, background: it.c }} title={`${it.label}: ${it.n}`} />
        )}
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 8, fontSize: 12, color: T.muted }}>
        {d.items.map((it) => (
          <span key={it.k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: it.c }} />
            {it.label} · {Math.round(it.pct)}%
          </span>
        ))}
      </div>
    </div>
  );
}

function Dot({ cat }) {
  const c = CAT_COLOR[cat] || T.faint;
  return <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 3, background: c, marginRight: 8, verticalAlign: "middle" }} />;
}

function Highlight({ text, brand, comps }) {
  const terms = [brand, ...comps].map((t) => (t || "").trim()).filter(Boolean);
  if (!terms.length) return <>{text}</>;
  const re = new RegExp(`(${terms.map(escapeRe).join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((p, i) => {
        if (p.toLowerCase() === brand.toLowerCase())
          return (
            <mark key={i} style={{ background: T.accentSoft, color: T.accent, padding: "1px 3px", borderRadius: 3 }}>
              {p}
            </mark>
          );
        if (comps.some((c) => c.toLowerCase() === p.toLowerCase()))
          return (
            <span key={i} style={{ borderBottom: `1px solid ${T.rule}` }}>
              {p}
            </span>
          );
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Btn({ children, onClick, primary, small, disabled }) {
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

export default function App() {
  const [tab, setTab] = useState("dash");
  const [brand, setBrand] = useState(SEED_BRAND);
  const [facts, setFacts] = useState(SEED_FACTS);
  const [api, setApi] = useState(SEED_API);
  const [judgePrompt, setJudgePrompt] = useState(DEFAULT_JUDGE_PROMPT);
  const [promptVer, setPromptVer] = useState(1);
  const [prompts, setPrompts] = useState(() =>
    RAW_PROMPTS.map((text, i) => ({ id: "p" + i, text, cat: classify(text, SEED_BRAND.aliases.split(",").map((s) => s.trim())), auto: true, active: true }))
  );
  const [sel, setSel] = useState(["gpt", "gem", "cld"]);
  const [repeats, setRepeats] = useState(3);
  const [progress, setProgress] = useState(null);
  const [runs, setRuns] = useState([]);
  const [runId, setRunId] = useState(null);
  const [slice, setSlice] = useState("all");
  const [fModel, setFModel] = useState("all");
  const [fCat, setFCat] = useState("all");
  const [fMiss, setFMiss] = useState(false);
  const [open, setOpen] = useState({});
  const timer = useRef(null);

  const aliases = brand.aliases.split(",").map((s) => s.trim()).filter(Boolean);
  const active = prompts.filter((p) => p.active);
  const requests = active.length * sel.length * repeats;
  const run = runs.find((r) => r.id === runId) || runs[runs.length - 1] || null;

  useEffect(() => {
    const hist = [];
    for (let w = 7; w >= 1; w--) {
      const d = new Date();
      d.setDate(d.getDate() - w * 7);
      hist.push(makeRun(-w, -w, d, active, w >= 6 ? sel.slice(0, 2) : sel, repeats, 1, SEED_API.judgeModel));
    }
    const today = makeRun(0, 0, new Date(), active, sel, repeats, promptVer, api.judgeModel);
    setRuns([...hist, today]);
    setRunId(today.id);
    return () => clearInterval(timer.current);
  }, []);

  function makeRun(salt, drift, date, ps, models, reps, pv, judge) {
    return {
      id: "r" + date.getTime() + "-" + salt,
      ts: date.getTime(),
      at: date.toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
      short: date.toLocaleDateString("ru-RU", { day: "numeric", month: "short" }).replace(".", ""),
      prompts: ps,
      models,
      repeats: reps,
      promptVer: pv,
      judgeModel: judge,
      rows: runEngine(ps, brand.name, brand.competitors, models, reps, salt, drift),
    };
  }

  function build() {
    const fresh = makeRun(runs.length + 1, 0, new Date(), active, sel, repeats, promptVer, api.judgeModel);
    setProgress(0);
    setTab("run");
    let done = 0;
    clearInterval(timer.current);
    timer.current = setInterval(() => {
      done += Math.max(1, Math.round(requests / 26));
      if (done >= requests) {
        clearInterval(timer.current);
        setProgress(null);
        setRuns((prev) => [...prev, fresh]);
        setRunId(fresh.id);
        setTab("dash");
      } else setProgress(done);
    }, 70);
  }

  const nav = [
    { group: "Отчёт", items: [["dash", "Дашборд"], ["answers", "Ответы"]] },
    { group: "Настройка", items: [["prompts", "Запросы"], ["facts", "База фактов"], ["brand", "Бренд"]] },
  ];

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
        {tab === "dash" && run && <Dashboard run={run} runs={runs} setRunId={setRunId} slice={slice} setSlice={setSlice} onGo={setTab} fModel={fModel} setFModel={setFModel} setFCat={setFCat} setFMiss={setFMiss} />}
        {tab === "answers" && run && (
          <Answers run={run} runs={runs} setRunId={setRunId} brand={brand} prompts={prompts} facts={facts} fModel={fModel} setFModel={setFModel} fCat={fCat} setFCat={setFCat} fMiss={fMiss} setFMiss={setFMiss} open={open} setOpen={setOpen} />
        )}
        {tab === "prompts" && <Prompts prompts={prompts} setPrompts={setPrompts} aliases={aliases} />}
        {tab === "facts" && <Facts facts={facts} setFacts={setFacts} />}
        {tab === "run" && <RunConfig sel={sel} setSel={setSel} repeats={repeats} setRepeats={setRepeats} prompts={active} requests={requests} progress={progress} onRun={() => build()} api={api} promptVer={promptVer} onGo={setTab} />}
        {tab === "settings" && (
          <Settings api={api} setApi={setApi} judgePrompt={judgePrompt} setJudgePrompt={setJudgePrompt} promptVer={promptVer} setPromptVer={setPromptVer} />
        )}
        {tab === "method" && <Method />}
        {tab === "brand" && <BrandSetup brand={brand} setBrand={setBrand} />}
      </main>
    </div>
  );
}

function Dashboard({ run, runs, setRunId, slice, setSlice, onGo, fModel, setFModel, setFCat, setFMiss }) {
  const inModel = (r) => fModel === "all" || r.model === fModel;
  const idx = runs.findIndex((r) => r.id === run.id);
  const prev = idx > 0 ? runs[idx - 1] : null;
  const sameSetup =
    prev &&
    prev.models.join() === run.models.join() &&
    prev.repeats === run.repeats &&
    prev.prompts.length === run.prompts.length &&
    prev.promptVer === run.promptVer;
  const setupNote = prev && !sameSetup ? "Настройки отличаются от предыдущего прогона — сравнение отключено." : "";
  const prevAgg = prev && sameSetup ? agg(prev.rows.filter((r) => r.cat !== "brand" && inModel(r) && (slice === "all" || r.cat === slice))) : null;
  const dl = (now, was) => (prevAgg ? Math.round(now - was) : undefined);
  // Тревоги считаются по всему прогону, а не по выбранной категории — иначе число прыгает при смене фильтра
  const alerts = {
    wrong: run.rows.filter((r) => inModel(r) && r.accuracy === "wrong").length,
    against: run.rows.filter((r) => inModel(r) && r.strength === "against").length,
  };
  const nonBrand = run.rows.filter((r) => r.cat !== "brand" && inModel(r));
  const scoped = slice === "all" ? nonBrand : nonBrand.filter((r) => r.cat === slice);
  const a = useMemo(() => agg(scoped), [scoped]);
  const b = useMemo(() => agg(run.rows.filter((r) => r.cat === "brand" && inModel(r))), [run, fModel]);
  const counts = { all: nonBrand.length, category: 0, competitive: 0, info: 0 };
  nonBrand.forEach((r) => counts[r.cat]++);

  const brandPrompts = run.prompts.filter((p) => p.cat === "brand");

  const weak = run.prompts
    .filter((p) => p.cat !== "brand" && (slice === "all" || p.cat === slice))
    .map((p) => {
      const rs = run.rows.filter((r) => r.promptId === p.id && inModel(r));
      return { p, v: rs.length ? rs.filter((r) => r.mention === "yes").length / rs.length : 0 };
    })
    .sort((x, y) => x.v - y.v)
    .slice(0, 3);

  useEffect(() => {
    if (fModel !== "all" && !run.models.includes(fModel)) setFModel("all");
  }, [run.id]);

  const trend = runs.map((r) => {
    const pt = { week: r.short };
    MODELS.forEach((m) => {
      const rs = r.rows.filter((x) => x.cat !== "brand" && x.model === m.id);
      pt[m.id] = rs.length ? Math.round((rs.filter((x) => x.mention === "yes").length / rs.length) * 100) : null;
    });
    return pt;
  });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
        <h1 style={{ font: `400 26px ${SERIF}`, margin: 0 }}>Прогон от {run.at}</h1>
        <RunPicker run={run} runs={runs} setRunId={setRunId} note={setupNote} />
      </div>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px" }}>
        {pl(run.prompts.length, "запрос", "запроса", "запросов")} · {pl(run.models.length, "модель", "модели", "моделей")} ·{" "}
        {pl(run.repeats, "повтор", "повтора", "повторов")} · без веб-поиска · {pl(run.rows.length, "ответ", "ответа", "ответов")}
        {fModel !== "all" && ` · показана только ${MODELS.find((x) => x.id === fModel).name}`}
      </p>

      {(alerts.against > 0 || alerts.wrong > 0) && (
        <div style={{ background: "#FBEDEC", border: "1px solid #F0D7D4", borderRadius: 8, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: T.neg, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>
            {[
              alerts.wrong > 0 ? `неверное описание бренда в ${pl(alerts.wrong, "ответе", "ответах", "ответах")}` : null,
              alerts.against > 0 ? `модель прямо не рекомендует бренд в ${pl(alerts.against, "ответе", "ответах", "ответах")}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <button
            onClick={() => { setFCat("all"); setFMiss(false); onGo("answers"); }}
            style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: `13px ${SANS}`, color: T.neg, textDecoration: "underline" }}
          >
            Посмотреть
          </button>
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: "0 14px", marginBottom: 18 }}>
        <div>
          <button className={"chip" + (fModel === "all" ? " on" : "")} onClick={() => setFModel("all")}>
            Все модели
          </button>
          {run.models.map((id) => (
            <button key={id} className={"chip" + (fModel === id ? " on" : "")} onClick={() => setFModel(id)}>
              {MODELS.find((x) => x.id === id).name}
            </button>
          ))}
        </div>
        <div style={{ width: 1, height: 20, background: T.rule, marginBottom: 8 }} />
        <div>
          {[["all", "Все небрендовые"], ["category", CATS.category], ["competitive", CATS.competitive], ["info", CATS.info]].map(([id, label]) => (
            <button key={id} className={"chip" + (slice === id ? " on" : "")} onClick={() => setSlice(id)}>
              {label} <span style={{ color: T.faint }}>{counts[id]}</span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "24px 0", borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`, padding: "24px 0", marginBottom: 34 }}>
        <Kpi
          first
          label="Факт упоминания"
          value={Math.round(a.mentionPct)}
          suffix="%"
          lead="есть в ответе"
          base={`${a.men} из ${pl(a.n, "ответа", "ответов", "ответов")}`}
          delta={dl(a.mentionPct, prevAgg && prevAgg.mentionPct)}
        />
        <Kpi
          label="Позиция"
          value={pctOf(a.position, "first")}
          suffix="%"
          lead="первым"
          base={`база ${a.position.base}`}
          delta={dl(pctOf(a.position, "first"), prevAgg && pctOf(prevAgg.position, "first"))}
        />
        <Kpi
          label="Точность"
          value={pctOf(a.accuracy, "exact")}
          suffix="%"
          lead="точно"
          base={a.wrong > 0 ? `${a.wrong} неверных · база ${a.accuracy.base}` : `база ${a.accuracy.base}`}
          delta={dl(pctOf(a.accuracy, "exact"), prevAgg && pctOf(prevAgg.accuracy, "exact"))}
        />
        <Kpi
          label="Тональность"
          value={pctOf(a.tone, "positive")}
          suffix="%"
          lead="позитивная"
          base={`база ${a.tone.base}`}
          delta={dl(pctOf(a.tone, "positive"), prevAgg && pctOf(prevAgg.tone, "positive"))}
        />
        <Kpi
          label="Сила рекомендации"
          value={pctOf(a.strength, "strong")}
          suffix="%"
          lead="явно рекомендует"
          base={a.against > 0 ? `${a.against} не рекомендует · база ${a.strength.base}` : `база ${a.strength.base}`}
          delta={dl(pctOf(a.strength, "strong"), prevAgg && pctOf(prevAgg.strength, "strong"))}
        />
      </div>

      <section style={{ marginBottom: 40 }}>
        <h2 style={{ font: `400 17px ${SANS}`, margin: "0 0 4px" }}>Распределение оценок</h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 18px", maxWidth: "70ch" }}>
          Все шкалы считаются только по ответам с упоминанием. Точность — по упоминаниям с проверяемым утверждением о компании.
        </p>
        <Bars title="Позиция в ответе" d={a.position} />
        <Bars title="Точность описания" d={a.accuracy} />
        <Bars title="Тональность" d={a.tone} />
        <Bars title="Сила рекомендации" d={a.strength} />
      </section>

      <section style={{ marginBottom: 44 }}>
        <h2 style={{ font: `400 17px ${SANS}`, margin: "0 0 4px" }}>Факт упоминания по неделям</h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px" }}>По всем небрендовым запросам · {pl(runs.length, "прогон", "прогона", "прогонов")} · разрыв линии означает, что модель в тот прогон не входила</p>
        <div style={{ display: "flex", gap: 18, marginBottom: 12, fontSize: 12, color: T.muted, flexWrap: "wrap" }}>
          {MODELS.map((m, i) => (
            <span key={m.id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <svg width="18" height="6" aria-hidden="true">
                <line x1="0" y1="3" x2="18" y2="3" stroke={LINE[i].c} strokeWidth="2" strokeDasharray={LINE[i].dash} />
              </svg>
              {m.name}
            </span>
          ))}
        </div>
        <div style={{ height: 220, maxWidth: 720 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={T.rule} vertical={false} />
              <XAxis dataKey="week" tick={{ fontSize: 12, fill: T.faint }} axisLine={{ stroke: T.rule }} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12, fill: T.faint }} axisLine={false} tickLine={false} unit="%" />
              <Tooltip contentStyle={{ fontSize: 13, borderRadius: 8, border: `1px solid ${T.rule}` }} formatter={(v, k) => [v + "%", MODELS.find((x) => x.id === k)?.name]} />
              {MODELS.map((m, i) => {
                const dim = fModel !== "all" && fModel !== m.id;
                return (
                  <Line
                    key={m.id}
                    type="monotone"
                    dataKey={m.id}
                    stroke={dim ? "#D8D8D3" : LINE[i].c}
                    strokeWidth={dim ? 1.5 : 2}
                    strokeDasharray={LINE[i].dash}
                    dot={false}
                    connectNulls={false}
                  />
                );
              })}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section style={{ marginBottom: 44 }}>
        <h2 style={{ font: `400 17px ${SANS}`, margin: "0 0 4px" }}>Запросы и модели</h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px" }}>Доля повторов с упоминанием бренда, по небрендовым запросам</p>
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: "left", fontWeight: 400, color: T.faint, fontSize: 12, padding: "0 0 8px" }}>Запрос</th>
              {run.models.map((id) => (
                <th key={id} style={{ width: 92, fontWeight: 400, color: T.faint, fontSize: 12, padding: "0 0 8px" }}>
                  {MODELS.find((x) => x.id === id).name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {["category", "competitive", "info"].map((cat) => {
              const ps = run.prompts.filter((p) => p.cat === cat);
              if (!ps.length) return null;
              return (
                <React.Fragment key={cat}>
                  <tr>
                    <td colSpan={run.models.length + 1} style={{ padding: "18px 0 6px", fontSize: 12, color: T.faint }}>
                      <Dot cat={cat} />
                      {CATS[cat]}
                    </td>
                  </tr>
                  {ps.map((p) => (
                    <tr key={p.id} style={{ borderTop: `1px solid ${T.rule}` }}>
                      <td style={{ padding: "9px 12px 9px 0" }}>{p.text}</td>
                      {run.models.map((id) => {
                        const rs = run.rows.filter((r) => r.promptId === p.id && r.model === id);
                        const v = rs.length ? Math.round((rs.filter((r) => r.mention === "yes").length / rs.length) * 100) : 0;
                        return (
                          <td key={id} style={{ textAlign: "center", padding: 5 }}>
                            <span style={{ display: "block", padding: "5px 0", borderRadius: 4, background: v === 0 ? "#F5F5F2" : `rgba(61,59,214,${(0.07 + (v / 100) * 0.42).toFixed(2)})`, color: v === 0 ? T.faint : T.ink, fontVariantNumeric: "tabular-nums" }}>
                              {v}%
                            </span>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </section>

      <section style={{ background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10, padding: "20px 26px", marginBottom: 44 }}>
        <h2 style={{ font: `400 17px ${SANS}`, margin: "0 0 4px" }}>Где теряем сильнее всего</h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 14px" }}>
          {slice === "all" ? "Небрендовые запросы с наименьшим упоминанием" : `${CATS[slice].toLowerCase()} запросы с наименьшим упоминанием`}
        </p>
        {weak.map(({ p, v }) => (
          <div key={p.id} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "9px 0", borderTop: `1px solid ${T.rule}` }}>
            <span style={{ fontFamily: SERIF, fontSize: 17, width: 46, color: v === 0 ? T.neg : T.ink, fontVariantNumeric: "tabular-nums" }}>{Math.round(v * 100)}%</span>
            <span style={{ fontSize: 14, flex: 1 }}>{p.text}</span>
            <span style={{ fontSize: 12, color: T.faint }}>
              <Dot cat={p.cat} />
              {CATS[p.cat]}
            </span>
          </div>
        ))}
        <div style={{ marginTop: 16 }}>
          <Btn small onClick={() => onGo("answers")}>
            Посмотреть ответы
          </Btn>
        </div>
      </section>

      <section style={{ background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10, padding: "22px 26px" }}>
        <h2 style={{ font: `400 17px ${SANS}`, margin: "0 0 4px" }}>
          <Dot cat="brand" />
          Брендовые запросы
        </h2>
        <p style={{ fontSize: 13, color: T.muted, margin: "0 0 20px", maxWidth: "70ch" }}>
          Бренд назван в самом вопросе, поэтому факт упоминания, позиция и сила рекомендации здесь не считаются — они вырождаются. Значение имеет то, насколько верно модель описывает компанию.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "20px 0", marginBottom: 24 }}>
          <Kpi
            first
            label="Точность"
            value={pctOf(b.accuracy, "exact")}
            suffix="%"
            lead="точно"
            base={b.wrong > 0 ? `${pl(b.wrong, "ответ", "ответа", "ответов")} с неверным описанием` : `база ${b.accuracy.base}`}
            size={28}
            alarm={b.wrong > 0}
          />
          <Kpi label="Тональность" value={pctOf(b.tone, "positive")} suffix="%" lead="позитивная" base={`база ${b.tone.base}`} size={28} />
          <Kpi
            label="Неузнавание"
            value={Math.round(100 - b.mentionPct)}
            suffix="%"
            lead="модель не знает компанию"
            base={`${b.n - b.men} из ${pl(b.n, "ответа", "ответов", "ответов")}`}
            size={28}
            alarm={b.men < b.n}
          />
        </div>
        <Bars title="Точность описания" d={b.accuracy} />
        <Bars title="Тональность" d={b.tone} />

        {brandPrompts.length > 0 && (
          <>
            <h3 style={{ font: `400 15px ${SANS}`, margin: "26px 0 4px" }}>Узнавание по запросам</h3>
            <p style={{ fontSize: 13, color: T.muted, margin: "0 0 14px" }}>Доля повторов, где модель узнала компанию. Ниже 100% — модель не знает бренд или путает его с другим</p>
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontWeight: 400, color: T.faint, fontSize: 12, padding: "0 0 8px" }}>Запрос</th>
                  {run.models.map((id) => (
                    <th key={id} style={{ width: 92, fontWeight: 400, color: T.faint, fontSize: 12, padding: "0 0 8px" }}>
                      {MODELS.find((x) => x.id === id).name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {brandPrompts.map((p) => (
                  <tr key={p.id} style={{ borderTop: `1px solid ${T.rule}` }}>
                    <td style={{ padding: "9px 12px 9px 0" }}>{p.text}</td>
                    {run.models.map((id) => {
                      const rs = run.rows.filter((r) => r.promptId === p.id && r.model === id);
                      const v = rs.length ? Math.round((rs.filter((r) => r.mention === "yes").length / rs.length) * 100) : null;
                      return (
                        <td key={id} style={{ textAlign: "center", padding: 5 }}>
                          <span
                            style={{
                              display: "block",
                              padding: "5px 0",
                              borderRadius: 4,
                              background: v === null ? "transparent" : v === 100 ? "#F2F2EF" : "#FBEDEC",
                              color: v === null ? T.faint : v === 100 ? T.muted : T.neg,
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {v === null ? "—" : `${v}%`}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </section>
    </div>
  );
}

function exportXlsx(rows, prompts, brand, runAt) {
  const nameOf = (id) => prompts.find((p) => p.id === id)?.text || id;
  const modelOf = (id) => MODELS.find((m) => m.id === id)?.name || id;

  const answers = rows.map((r) => ({
    "Дата прогона": runAt,
    Категория: CATS[r.cat],
    Запрос: nameOf(r.promptId),
    Модель: modelOf(r.model),
    Повтор: r.repeat,
    "Факт упоминания": r.mention === "yes" ? "Есть" : "Нет",
    Позиция: r.position ? LBL[r.position] : "",
    Точность: r.accuracy ? LBL[r.accuracy] : "",
    Тональность: r.mention === "yes" ? LBL[r.tone] : "",
    "Сила рекомендации": r.strength ? LBL[r.strength] : "",
    "Ответ модели": r.text,
  }));

  const map = new Map();
  rows.forEach((r) => {
    const key = r.promptId + "|" + r.model;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  const summary = [...map.values()].map((reps) => {
    const men = reps.filter((x) => x.mention === "yes").length;
    const stable = new Set(reps.map((x) => `${x.mention}|${x.strength}|${x.accuracy}`)).size === 1;
    return {
      Категория: CATS[reps[0].cat],
      Запрос: nameOf(reps[0].promptId),
      Модель: modelOf(reps[0].model),
      Повторов: reps.length,
      Упоминаний: men,
      "Доля упоминаний": reps.length ? Math.round((men / reps.length) * 100) / 100 : 0,
      Стабильность: stable ? "Одинаковые ответы" : "Ответы различаются",
    };
  });

  const wb = XLSX.utils.book_new();

  const ws1 = XLSX.utils.json_to_sheet(answers);
  ws1["!cols"] = [{ wch: 14 }, { wch: 16 }, { wch: 46 }, { wch: 12 }, { wch: 8 }, { wch: 16 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 20 }, { wch: 100 }];
  ws1["!views"] = [{ state: "frozen", ySplit: 1 }];
  ws1["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: answers.length, c: 10 } }) };
  XLSX.utils.book_append_sheet(wb, ws1, "Ответы");

  const ws2 = XLSX.utils.json_to_sheet(summary);
  ws2["!cols"] = [{ wch: 16 }, { wch: 46 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 16 }, { wch: 22 }];
  ws2["!views"] = [{ state: "frozen", ySplit: 1 }];
  XLSX.utils.book_append_sheet(wb, ws2, "Сводка");

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${brand.name.toLowerCase()}-ai-monitoring-${stamp}.xlsx`);
}

const PER_PAGE = 50;

function Answers({ run, runs, setRunId, brand, prompts, facts, fModel, setFModel, fCat, setFCat, fMiss, setFMiss, open, setOpen }) {
  const [rep, setRep] = useState({});
  const [page, setPage] = useState(0);
  const [err, setErr] = useState("");

  // Сначала ищем в снимке прогона: запрос могли переименовать или удалить уже после него
  const title = (id) => (run.prompts.find((p) => p.id === id) || prompts.find((p) => p.id === id) || {}).text || id;

  const groups = useMemo(() => {
    const map = new Map();
    run.rows
      .filter((r) => (fModel === "all" || r.model === fModel) && (fCat === "all" || r.cat === fCat))
      .forEach((r) => {
        const key = r.promptId + "|" + r.model;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      });
    return [...map.entries()].map(([key, reps]) => ({ key, reps }));
  }, [run, fModel, fCat]);

  const shown = groups.filter((g) => !fMiss || g.reps.every((r) => r.mention === "no"));
  const flat = shown.flatMap((g) => g.reps);
  const pages = Math.max(1, Math.ceil(shown.length / PER_PAGE));
  const current = Math.min(page, pages - 1);
  const pageItems = shown.slice(current * PER_PAGE, current * PER_PAGE + PER_PAGE);

  useEffect(() => {
    setPage(0);
  }, [fModel, fCat, fMiss, run.id]);

  const verdict = (r) =>
    r.mention === "no"
      ? { t: "не упомянут", bg: "#F6F1E9", c: T.warn, dot: "#E0D2BB" }
      : r.accuracy === "wrong"
      ? { t: "неверно", bg: "#FBEDEC", c: T.neg, dot: T.neg }
      : r.strength === "against"
      ? { t: "не рекомендует", bg: "#FBEDEC", c: T.neg, dot: T.neg }
      : { t: r.cat === "brand" ? LBL[r.accuracy] : LBL[r.strength], bg: T.accentSoft, c: T.accent, dot: T.accent };

  const toggle = (key, force) => setOpen({ ...open, [key]: force !== undefined ? force : !open[key] });

  return (
    <div>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 6px" }}>Ответы моделей</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px", maxWidth: "72ch" }}>
        Повторы одного запроса к одной модели собраны в карточку. Текст ответа раскрывается по клику.
      </p>
      <div style={{ marginBottom: 20 }}>
        <RunPicker run={run} runs={runs} setRunId={setRunId} />
      </div>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 20, flexWrap: "wrap" }}>
        <select value={fModel} onChange={(e) => setFModel(e.target.value)}>
          <option value="all">Все модели</option>
          {run.models.map((id) => (
            <option key={id} value={id}>
              {MODELS.find((x) => x.id === id).name}
            </option>
          ))}
        </select>
        <select value={fCat} onChange={(e) => setFCat(e.target.value)}>
          <option value="all">Все категории</option>
          {Object.entries(CATS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <label style={{ fontSize: 14, display: "flex", alignItems: "center", gap: 8, color: T.muted }}>
          <input type="checkbox" checked={fMiss} onChange={(e) => setFMiss(e.target.checked)} style={{ padding: 0 }} />
          Только где нас нет ни в одном повторе
        </label>
        <span style={{ fontSize: 13, color: T.faint, marginLeft: "auto" }}>
          {pl(shown.length, "карточка", "карточки", "карточек")} · {pl(flat.length, "ответ", "ответа", "ответов")}
        </span>
        <Btn
          small
          onClick={() => {
            try {
              exportXlsx(flat, run.prompts, brand, run.at);
              setErr("");
            } catch (e) {
              setErr("Не удалось собрать файл. Попробуйте ещё раз.");
            }
          }}
          disabled={flat.length === 0}
        >
          Выгрузить в Excel
        </Btn>
      </div>

      {err && <p style={{ fontSize: 13, color: T.neg, margin: "-8px 0 16px" }}>{err}</p>}

      {pageItems.map((g) => {
        const idx = Math.min(rep[g.key] || 0, g.reps.length - 1);
        const r = g.reps[idx];
        const v = verdict(r);
        const men = g.reps.filter((x) => x.mention === "yes").length;
        const stable = new Set(g.reps.map((x) => `${x.mention}|${x.position}|${x.strength}|${x.accuracy}|${x.tone}`)).size === 1;
        const isOpen = !!open[g.key];

        return (
          <article key={g.key} style={{ background: T.surface, border: `1px solid ${T.rule}`, borderRadius: 10, padding: "14px 20px", marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "baseline", marginBottom: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>
                <Dot cat={r.cat} />
                {title(r.promptId)}
              </span>
              <span style={{ fontSize: 12, color: T.faint, marginLeft: "auto" }}>{MODELS.find((x) => x.id === r.model).name}</span>
            </div>

            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, color: T.muted }}>
                упомянут в {men} из {g.reps.length}
              </span>
              {!stable && <span style={{ fontSize: 12, color: T.warn }}>ответы различаются</span>}
              {stable && <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: v.bg, color: v.c }}>{v.t}</span>}

              <span style={{ display: "flex", gap: 4, marginLeft: "auto", alignItems: "center" }}>
                {g.reps.map((x, i) => (
                  <button
                    key={i}
                    onClick={() => { setRep({ ...rep, [g.key]: i }); toggle(g.key, true); }}
                    aria-label={`Повтор ${i + 1}`}
                    style={{
                      font: `12px ${SANS}`,
                      cursor: "pointer",
                      width: 30,
                      height: 26,
                      borderRadius: 5,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      background: isOpen && i === idx ? T.accentSoft : T.surface,
                      border: `1px solid ${isOpen && i === idx ? T.accent : T.rule}`,
                      color: isOpen && i === idx ? T.accent : T.muted,
                    }}
                  >
                    <span style={{ width: 5, height: 5, borderRadius: 3, background: verdict(x).dot }} />
                    {i + 1}
                  </button>
                ))}
                <button onClick={() => toggle(g.key)} style={{ border: "none", background: "none", padding: "0 0 0 8px", cursor: "pointer", font: `13px ${SANS}`, color: T.accent }}>
                  {isOpen ? "Свернуть" : "Показать ответ"}
                </button>
              </span>
            </div>

            {isOpen && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${T.rule}` }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", marginBottom: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 12, color: T.faint }}>повтор {idx + 1}</span>
                  <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 4, background: v.bg, color: v.c }}>{v.t}</span>
                </div>
                <p style={{ fontSize: 14, lineHeight: 1.65, margin: "0 0 14px", maxWidth: "74ch" }}>
                  <Highlight text={r.text} brand={brand.name} comps={brand.competitors} />
                </p>
                <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.8 }}>
                  <div>Категория запроса — {CATS[r.cat]}</div>
                  <div>Факт упоминания — {r.mention === "yes" ? "есть, найдено по алиасам" : "нет"}</div>
                  <div>Позиция — {r.position ? LBL[r.position] : "не применима"}</div>
                  <div>Точность — {r.accuracy ? `${LBL[r.accuracy]}, сверено с ${pl(facts.length, "фактом", "фактами", "фактами")}` : "проверяемых утверждений нет"}</div>
                  <div>Тональность — {r.mention === "yes" ? LBL[r.tone] : "не применима"}</div>
                  <div>Сила рекомендации — {r.strength ? LBL[r.strength] : "не применима"}</div>
                </div>
              </div>
            )}
          </article>
        );
      })}

      {shown.length === 0 && <p style={{ fontSize: 14, color: T.muted, padding: "20px 0" }}>Под фильтр ничего не попало.</p>}

      {pages > 1 && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 24, flexWrap: "wrap" }}>
          <Btn small disabled={current === 0} onClick={() => setPage(current - 1)}>
            Назад
          </Btn>
          {Array.from({ length: pages }, (_, i) => (
            <button
              key={i}
              onClick={() => setPage(i)}
              style={{
                font: `13px ${SANS}`,
                cursor: "pointer",
                minWidth: 32,
                height: 32,
                borderRadius: 6,
                background: i === current ? T.accentSoft : T.surface,
                border: `1px solid ${i === current ? T.accent : T.rule}`,
                color: i === current ? T.accent : T.muted,
              }}
            >
              {i + 1}
            </button>
          ))}
          <Btn small disabled={current === pages - 1} onClick={() => setPage(current + 1)}>
            Вперёд
          </Btn>
          <span style={{ fontSize: 13, color: T.faint, marginLeft: 10 }}>
            {current * PER_PAGE + 1}–{Math.min((current + 1) * PER_PAGE, shown.length)} из {shown.length}
          </span>
        </div>
      )}
    </div>
  );
}

function Prompts({ prompts, setPrompts, aliases }) {
  const [draft, setDraft] = useState("");
  const [bulk, setBulk] = useState(false);
  const [text, setText] = useState("");

  function add(list) {
    const existing = new Set(prompts.map((p) => p.text.toLowerCase()));
    const fresh = list
      .map((t) => t.trim())
      .filter((t) => t && !existing.has(t.toLowerCase()))
      .map((t, i) => ({ id: "n" + Date.now() + i, text: t, cat: classify(t, aliases), auto: true, active: true }));
    setPrompts([...prompts, ...fresh]);
  }

  const counts = {};
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
                <input type="checkbox" checked={p.active} onChange={() => setPrompts(prompts.map((x) => (x.id === p.id ? { ...x, active: !x.active } : x)))} style={{ padding: 0 }} />
              </td>
              <td style={{ padding: "12px 0", color: p.active ? T.ink : T.faint }}>{p.text}</td>
              <td style={{ padding: "12px 16px", width: 196, textAlign: "right" }}>
                <select value={p.cat} onChange={(e) => setPrompts(prompts.map((x) => (x.id === p.id ? { ...x, cat: e.target.value, auto: false } : x)))} style={{ fontSize: 13, padding: "5px 8px" }}>
                  {Object.entries(CATS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <span style={{ fontSize: 11, color: T.faint, marginLeft: 8 }}>{p.auto ? "авто" : "вручную"}</span>
              </td>
              <td style={{ padding: "12px 16px", width: 40 }}>
                <button onClick={() => setPrompts(prompts.filter((x) => x.id !== p.id))} style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, fontSize: 16 }} aria-label="Удалить запрос">
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

function Facts({ facts, setFacts }) {
  const [draft, setDraft] = useState("");
  const push = () => {
    if (!draft.trim()) return;
    setFacts([...facts, { id: "f" + Date.now(), text: draft.trim() }]);
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
                <button onClick={() => setFacts(facts.filter((x) => x.id !== f.id))} style={{ border: "none", background: "none", cursor: "pointer", color: T.faint, fontSize: 16 }} aria-label="Удалить факт">
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

function RunConfig({ sel, setSel, repeats, setRepeats, prompts, requests, progress, onRun, api, promptVer, onGo }) {
  const cost = Math.round(requests * 0.62);
  const mins = Math.max(1, Math.round(requests / 180));
  const counts = {};
  prompts.forEach((p) => (counts[p.cat] = (counts[p.cat] || 0) + 1));
  const thin = Object.entries(CATS).filter(([k]) => (counts[k] || 0) < 10);

  if (progress !== null)
    return (
      <div style={{ maxWidth: 520, margin: "60px auto", textAlign: "center" }}>
        <h1 style={{ font: `400 22px ${SERIF}`, margin: "0 0 24px" }}>Идёт прогон</h1>
        <div style={{ height: 6, background: "#EFEFEC", borderRadius: 3, overflow: "hidden", marginBottom: 12 }}>
          <div style={{ height: "100%", width: `${(progress / requests) * 100}%`, background: T.accent }} />
        </div>
        <p style={{ fontSize: 13, color: T.muted }}>
          {progress} из {pl(requests, "запроса", "запросов", "запросов")}
        </p>
      </div>
    );

  return (
    <div style={{ maxWidth: 640 }}>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 6px" }}>Новый прогон</h1>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 28px" }}>Веб-поиск выключен — так ответы сравнимы между собой и между неделями.</p>

      <h2 style={{ font: `400 15px ${SANS}`, margin: "0 0 12px" }}>Модели</h2>
      <div style={{ marginBottom: 28 }}>
        {MODELS.map((mo) => (
          <label key={mo.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", background: T.surface, border: `1px solid ${sel.includes(mo.id) ? T.accent : T.rule}`, borderRadius: 8, marginBottom: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={sel.includes(mo.id)} onChange={() => setSel(sel.includes(mo.id) ? sel.filter((x) => x !== mo.id) : [...sel, mo.id])} style={{ padding: 0 }} />
            <span style={{ fontSize: 14 }}>{mo.name}</span>
            <span style={{ fontSize: 12, color: T.faint, marginLeft: "auto", fontFamily: "ui-monospace, monospace" }}>{mo.api}</span>
          </label>
        ))}
      </div>

      <h2 style={{ font: `400 15px ${SANS}`, margin: "0 0 8px" }}>Повторов на запрос</h2>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 12px", maxWidth: "64ch" }}>Модели отвечают по-разному на один и тот же вопрос. Один повтор — это шум, а не замер.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 30 }}>
        <input type="range" min={1} max={5} step={1} value={repeats} onChange={(e) => setRepeats(+e.target.value)} style={{ flex: 1, padding: 0, border: "none" }} />
        <span style={{ fontFamily: SERIF, fontSize: 20, width: 20 }}>{repeats}</span>
      </div>

      <div style={{ borderTop: `1px solid ${T.rule}`, borderBottom: `1px solid ${T.rule}`, padding: "20px 0", marginBottom: 20, display: "flex", gap: 40, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Запросов к API</div>
          <Num value={requests} />
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Примерно займёт</div>
          <Num value={mins} suffix=" мин" />
        </div>
        <div>
          <div style={{ fontSize: 12, color: T.muted, marginBottom: 6 }}>Ориентировочно</div>
          <Num value={cost} suffix=" ₽" />
          <div style={{ fontSize: 12, color: T.faint, marginTop: 6, maxWidth: 190, lineHeight: 1.5 }}>Точная сумма придёт от шлюза после прогона</div>
        </div>
      </div>

      {thin.length > 0 && (
        <div style={{ background: "#FBF6EC", border: "1px solid #EBDFC8", borderRadius: 8, padding: "14px 16px", marginBottom: 22, fontSize: 13, color: T.warn, lineHeight: 1.6 }}>
          Мало запросов для устойчивой статистики: {thin.map(([k]) => `${CATS[k].toLowerCase()} — ${counts[k] || 0}`).join(", ")}. Рабочий минимум — 10–15 на категорию, иначе недельные колебания будут шумом.
        </div>
      )}

      {!api.key && (
        <div style={{ background: "#FBF6EC", border: "1px solid #EBDFC8", borderRadius: 8, padding: "14px 16px", marginBottom: 22, fontSize: 13, color: T.warn, lineHeight: 1.6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>Ключ API не указан — прогон пойдёт на демонстрационных данных.</span>
          <button onClick={() => onGo("settings")} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: `13px ${SANS}`, color: T.warn, textDecoration: "underline" }}>
            Настроить подключение
          </button>
        </div>
      )}

      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 20px", lineHeight: 1.6 }}>
        Судья — {api.judgeModel}, промпт версии {promptVer}. Эти настройки записываются в прогон и учитываются при сравнении.
      </p>

      <Btn primary onClick={onRun} disabled={!sel.length || !prompts.length}>
        Запустить прогон
      </Btn>
    </div>
  );
}

function BrandSetup({ brand, setBrand }) {
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

      {[["Название", "name"], ["Алиасы через запятую", "aliases"]].map(([label, key]) => (
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

const WHEN = {
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

function ScaleBlock({ title, question, scale, base, skip }) {
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

const DEFAULT_JUDGE = `Ты размечаешь ответы ИИ-моделей о компании. Оцени ТОЛЬКО отношение к бренду,
не к рынку и не к конкурентам. Верни строго JSON, без пояснений вокруг.

БРЕНД: {brand} (также: {aliases})
КОНКУРЕНТЫ: {competitors}
ФАКТЫ О КОМПАНИИ: {facts}
ВОПРОС: {prompt}
ОТВЕТ МОДЕЛИ: {answer}

tone — как о бренде отзываются:
  none — бренд назван, но не оценён (просто в перечне)
  neutral — оценка есть, без окраски
  positive / negative — оценка положительная / отрицательная
  mixed — есть и плюс, и минус про сам бренд

strength — что советуют сделать:
  mention — перечислен наряду с другими
  peer — среди рекомендуемых, но не выделен
  strong — есть маркер предпочтения («в первую очередь», «лучший выбор»)
  against — прямой совет не брать

accuracy — верно ли описана компания, сверять с ФАКТАМИ:
  exact — всё соответствует
  partial — верно, но неполно
  wrong — есть противоречие фактам или приписан чужой профиль

Оси независимы. Пример: «Хорошее оборудование, но под вашу задачу
возьмите другое» → tone: positive, strength: against.
Если бренд не упомянут — все поля null.

Формат: {"tone":"","strength":"","accuracy":"","evidence":"","note":""}
evidence — фрагмент ответа, на котором основана оценка
note — одно предложение, почему именно так`;

function Settings({ api, setApi, judgePrompt, setJudgePrompt, promptVer, setPromptVer }) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState(judgePrompt);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const dirty = draft !== judgePrompt;

  const upload = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { setDraft(String(reader.result)); setErr(""); };
    reader.onerror = () => setErr("Не удалось прочитать файл.");
    reader.readAsText(file);
    e.target.value = "";
  };

  const save = () => {
    if (!draft.trim()) { setErr("Промпт не может быть пустым."); return; }
    setJudgePrompt(draft);
    setPromptVer(promptVer + 1);
    setErr("");
  };

  const field = (label, key, ph, hint) => (
    <div style={{ marginBottom: 20 }}>
      <label style={{ display: "block", fontSize: 13, color: T.muted, marginBottom: 6 }}>{label}</label>
      <input value={api[key]} placeholder={ph} onChange={(e) => setApi({ ...api, [key]: e.target.value })} style={{ width: "100%" }} />
      {hint && <p style={{ fontSize: 12, color: T.faint, margin: "6px 0 0", lineHeight: 1.5 }}>{hint}</p>}
    </div>
  );

  return (
    <div style={{ maxWidth: 760 }}>
      <h1 style={{ font: `400 26px ${SERIF}`, margin: "0 0 8px" }}>Подключение</h1>
      <p style={{ fontSize: 14, color: T.muted, margin: "0 0 32px", lineHeight: 1.7, maxWidth: "70ch" }}>
        Один ключ на все модели: и на те, что отвечают, и на модель-судью. Отдельной интеграции для судьи не нужно — это запрос к тому же шлюзу.
      </p>

      <h2 style={{ font: `400 18px ${SANS}`, margin: "0 0 16px" }}>Шлюз</h2>

      <div style={{ marginBottom: 20 }}>
        <label style={{ display: "block", fontSize: 13, color: T.muted, marginBottom: 6 }}>Провайдер</label>
        <select value={api.provider} onChange={(e) => setApi({ ...api, provider: e.target.value })} style={{ width: "100%" }}>
          <option value="aitunnel">AITunnel</option>
          <option value="custom">Другой OpenAI-совместимый</option>
        </select>
      </div>

      {field("Адрес API", "baseUrl", "https://…", "Проверьте актуальный адрес в документации шлюза — он может отличаться.")}

      <div style={{ marginBottom: 8 }}>
        <label style={{ display: "block", fontSize: 13, color: T.muted, marginBottom: 6 }}>Ключ</label>
        <div style={{ display: "flex", gap: 10 }}>
          <input
            type={showKey ? "text" : "password"}
            value={api.key}
            placeholder="вставьте ключ"
            onChange={(e) => setApi({ ...api, key: e.target.value })}
            style={{ flex: 1 }}
          />
          <Btn small onClick={() => setShowKey(!showKey)}>{showKey ? "Скрыть" : "Показать"}</Btn>
        </div>
      </div>
      <p style={{ fontSize: 12, color: T.faint, margin: "0 0 20px", lineHeight: 1.6, maxWidth: "70ch" }}>
        В рабочей версии ключ сохраняется на сервере и обратно в браузер не возвращается — здесь будет видно только последние четыре знака. Хранить его в интерфейсе целиком нельзя: любой, кто откроет вкладку разработчика, заберёт его вместе с балансом.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Btn onClick={() => setStatus("В прототипе проверка не выполняется. В рабочей версии здесь появится статус подключения и список доступных моделей.")} disabled={!api.key}>
          Проверить подключение
        </Btn>
        {!api.key && <span style={{ fontSize: 13, color: T.faint }}>сначала вставьте ключ</span>}
      </div>
      {status && <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px", maxWidth: "70ch", lineHeight: 1.6 }}>{status}</p>}

      <h2 style={{ font: `400 18px ${SANS}`, margin: "36px 0 8px" }}>Модели</h2>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px", maxWidth: "70ch" }}>
        Указывайте точный идентификатор из каталога шлюза, без префикса провайдера. Не используйте <code>auto</code> и плавающие алиасы «последней версии»: модель подменится молча, и скачок метрики будет не отличить от реального изменения.
      </p>
      {MODELS.map((m) => (
        <div key={m.id} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, flex: "0 0 110px" }}>{m.name}</span>
          <input defaultValue={m.api} style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
        </div>
      ))}

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 20, paddingTop: 20, borderTop: `1px solid ${T.rule}`, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, flex: "0 0 110px" }}>Судья</span>
        <input value={api.judgeModel} onChange={(e) => setApi({ ...api, judgeModel: e.target.value })} style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 13 }} />
      </div>
      <p style={{ fontSize: 12, color: T.faint, margin: "8px 0 0", lineHeight: 1.6, maxWidth: "70ch" }}>
        Берите дешёвую модель — судья выдаёт несколько десятков токенов. Она не должна совпадать с проверяемыми, иначе оценка будет смещённой.
      </p>

      <h2 style={{ font: `400 18px ${SANS}`, margin: "40px 0 8px" }}>Параметры запроса</h2>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 20px", maxWidth: "70ch", lineHeight: 1.6 }}>
        Эти настройки влияют на сопоставимость замеров сильнее, чем выбор моделей.
      </p>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 18, flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, flex: "0 0 190px" }}>Лимит токенов в ответе</span>
        <input
          type="number"
          value={api.maxTokens}
          min={200}
          step={100}
          onChange={(e) => setApi({ ...api, maxTokens: +e.target.value })}
          style={{ width: 120 }}
        />
        <span style={{ fontSize: 12, color: T.faint, flex: 1, minWidth: 240, lineHeight: 1.5 }}>
          По этому значению шлюз резервирует стоимость запроса, после ответа списывается фактический расход.
        </span>
      </div>

      <label style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 14, cursor: "pointer" }}>
        <input type="checkbox" checked={api.pinProvider} onChange={(e) => setApi({ ...api, pinProvider: e.target.checked })} style={{ padding: 0, marginTop: 3 }} />
        <span>
          <span style={{ fontSize: 14 }}>Закреплять провайдера</span>
          <span style={{ display: "block", fontSize: 12, color: T.faint, marginTop: 3, maxWidth: "62ch", lineHeight: 1.6 }}>
            У одной модели может быть несколько провайдеров, и ответы у них слегка расходятся. Без закрепления появляется источник разброса, который вы не контролируете.
          </span>
        </span>
      </label>

      <label style={{ display: "flex", gap: 12, alignItems: "flex-start", marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={api.fallback} onChange={(e) => setApi({ ...api, fallback: e.target.checked })} style={{ padding: 0, marginTop: 3 }} />
        <span>
          <span style={{ fontSize: 14 }}>Разрешить запасные модели</span>
          <span style={{ display: "block", fontSize: 12, color: T.faint, marginTop: 3, maxWidth: "62ch", lineHeight: 1.6 }}>
            При отказе провайдера запрос уйдёт другой модели. Для обычных задач удобно, для замера — нет.
          </span>
        </span>
      </label>

      {api.fallback && (
        <div style={{ background: "#FBEDEC", border: "1px solid #F0D7D4", borderRadius: 8, padding: "12px 16px", marginBottom: 10, fontSize: 13, color: T.neg, lineHeight: 1.6, maxWidth: "70ch" }}>
          В отчёт попадут ответы не той модели, которая указана в колонке. Метрики по моделям станут недостоверными.
        </div>
      )}

      <h2 style={{ font: `400 18px ${SANS}`, margin: "40px 0 8px" }}>Промпт судьи</h2>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px", maxWidth: "70ch", lineHeight: 1.6 }}>
        Подстановки в фигурных скобках заполняются автоматически: {"{brand}"}, {"{aliases}"}, {"{competitors}"}, {"{facts}"}, {"{prompt}"}, {"{answer}"}.
      </p>

      <div style={{ background: "#FBF6EC", border: "1px solid #EBDFC8", borderRadius: 8, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: T.warn, lineHeight: 1.6, maxWidth: "70ch" }}>
        Правка промпта меняет правила оценки, поэтому прогоны до и после сравнивать нельзя. Версия промпта записывается в каждый прогон — на графиках точка смены будет отмечена.
      </div>

      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={18} style={{ width: "100%", resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 12, lineHeight: 1.6 }} />

      {err && <p style={{ fontSize: 13, color: T.neg, margin: "8px 0 0" }}>{err}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 14, flexWrap: "wrap" }}>
        <Btn primary onClick={save} disabled={!dirty}>Сохранить как версию {promptVer + 1}</Btn>
        <Btn onClick={() => { setDraft(judgePrompt); setErr(""); }} disabled={!dirty}>Отменить</Btn>
        <label style={{ font: `13px ${SANS}`, padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.rule}`, background: T.surface, cursor: "pointer" }}>
          Загрузить из файла
          <input type="file" accept=".txt,.md" onChange={upload} style={{ display: "none" }} />
        </label>
        <Btn small onClick={() => { setDraft(DEFAULT_JUDGE_PROMPT); setErr(""); }}>Вернуть стандартный</Btn>
        <span style={{ fontSize: 13, color: T.faint, marginLeft: "auto" }}>
          текущая версия {promptVer} · {draft.length} знаков
        </span>
      </div>
    </div>
  );
}
