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
type Model = { id: string; name: string; api: string };
type ApiSettings = {
  provider: string;
  baseUrl: string;
  models: Model[];
  judgeModel: string;
  maxTokens: number;
  pinProvider: boolean;
  fallback: boolean;
  key_configured: boolean;
  key_last4: string | null;
};
type Run = {
  id: number;
  at: string;
  started_at: string;
  status: string;
  planned: number;
  done: number;
  failed: number;
  cost_rub: number;
};
type NumProps = { value: number | string; suffix?: string; size?: number };
type RunConfigProps = {
  sel: string[];
  setSel: (next: string[]) => void;
  repeats: number;
  setRepeats: (n: number) => void;
  prompts: Prompt[];
  requests: number;
  progress: number | null;
  onRun: () => void;
  api: ApiSettings;
  promptVer: number;
  onGo: (tab: string) => void;
};
type SettingsProps = {
  api: ApiSettings;
  setApi: (next: ApiSettings) => void;
  judgePrompt: string;
  saveJudge: (text: string) => void;
  promptVer: number;
  defaultJudgePrompt: string;
};
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

function Num({ value, suffix, size }: NumProps) {
  return (
    <span style={{ fontFamily: SERIF, fontSize: size || 32, lineHeight: 1.05, color: T.ink, fontVariantNumeric: "tabular-nums" }}>
      {value}
      {suffix ? <span style={{ fontSize: (size || 32) * 0.6, color: T.muted }}>{suffix}</span> : null}
    </span>
  );
}

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

function RunConfig({ sel, setSel, repeats, setRepeats, prompts, requests, progress, onRun, api, promptVer, onGo }: RunConfigProps) {
  const cost = Math.round(requests * 0.62);
  // На каждый ответ уходит два обращения к шлюзу — к модели и к судье — плюс
  // паузы между ними. По факту около 6,5 секунды на ответ, запросы идут по очереди.
  const mins = Math.max(1, Math.round((requests * 6.5) / 60));
  const counts: Record<string, number> = {};
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
        {api.models.map((mo) => (
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

      {!api.key_configured && (
        <div style={{ background: "#FBF6EC", border: "1px solid #EBDFC8", borderRadius: 8, padding: "14px 16px", marginBottom: 22, fontSize: 13, color: T.warn, lineHeight: 1.6, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <span>Ключ API не указан — прогон невозможен.</span>
          <button onClick={() => onGo("settings")} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", font: `13px ${SANS}`, color: T.warn, textDecoration: "underline" }}>
            Настроить подключение
          </button>
        </div>
      )}

      <p style={{ fontSize: 13, color: T.faint, margin: "0 0 20px", lineHeight: 1.6 }}>
        Судья — {api.judgeModel}, промпт версии {promptVer}. Эти настройки записываются в прогон и учитываются при сравнении.
      </p>

      <Btn primary onClick={onRun} disabled={!sel.length || !prompts.length || !api.key_configured}>
        Запустить прогон
      </Btn>
    </div>
  );
}

function Settings({ api, setApi, judgePrompt, saveJudge, promptVer, defaultJudgePrompt }: SettingsProps) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState(judgePrompt);
  const [status, setStatus] = useState("");
  const [err, setErr] = useState("");
  const dirty = draft !== judgePrompt;

  const check = () => {
    setStatus("Проверяю…");
    fetch("/api/test-connection", { method: "POST" })
      .then((r) => r.json())
      .then((d) =>
        setStatus(d.ok ? `Подключение работает, модель ${d.model} отвечает.` : `Не удалось подключиться. ${d.error}`)
      )
      .catch(() => setStatus("Не удалось подключиться."));
  };

  useEffect(() => {
    setDraft(judgePrompt);
  }, [judgePrompt]);

  const upload = (e: React.ChangeEvent<HTMLInputElement>) => {
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
    saveJudge(draft);
    setErr("");
  };

  const field = (label: string, key: "provider" | "baseUrl", ph: string, hint?: string) => (
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
            type="text"
            readOnly
            value={api.key_configured ? (showKey ? `••••••••••••${api.key_last4}` : "••••••••••••••••") : ""}
            placeholder="ключ задаётся в файле .env на сервере"
            style={{ flex: 1 }}
          />
          <Btn small onClick={() => setShowKey(!showKey)}>{showKey ? "Скрыть" : "Показать"}</Btn>
        </div>
      </div>
      <p style={{ fontSize: 12, color: T.faint, margin: "0 0 20px", lineHeight: 1.6, maxWidth: "70ch" }}>
        В рабочей версии ключ сохраняется на сервере и обратно в браузер не возвращается — здесь будет видно только последние четыре знака. Хранить его в интерфейсе целиком нельзя: любой, кто откроет вкладку разработчика, заберёт его вместе с балансом.
      </p>

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12, flexWrap: "wrap" }}>
        <Btn onClick={check} disabled={!api.key_configured}>
          Проверить подключение
        </Btn>
        {!api.key_configured && <span style={{ fontSize: 13, color: T.faint }}>сначала вставьте ключ</span>}
      </div>
      {status && <p style={{ fontSize: 13, color: T.muted, margin: "0 0 24px", maxWidth: "70ch", lineHeight: 1.6 }}>{status}</p>}

      <h2 style={{ font: `400 18px ${SANS}`, margin: "36px 0 8px" }}>Модели</h2>
      <p style={{ fontSize: 13, color: T.muted, margin: "0 0 16px", maxWidth: "70ch" }}>
        Указывайте точный идентификатор из каталога шлюза, без префикса провайдера. Не используйте <code>auto</code> и плавающие алиасы «последней версии»: модель подменится молча, и скачок метрики будет не отличить от реального изменения.
      </p>
      {api.models.map((m, i) => (
        <div key={m.id} style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, flex: "0 0 110px" }}>{m.name}</span>
          <input
            value={m.api}
            onChange={(e) =>
              setApi({ ...api, models: api.models.map((x, j) => (j === i ? { ...x, api: e.target.value } : x)) })
            }
            style={{ flex: 1, fontFamily: "ui-monospace, monospace", fontSize: 13 }}
          />
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
        <Btn small onClick={() => { setDraft(defaultJudgePrompt); setErr(""); }}>Вернуть стандартный</Btn>
        <span style={{ fontSize: 13, color: T.faint, marginLeft: "auto" }}>
          текущая версия {promptVer} · {draft.length} знаков
        </span>
      </div>
    </div>
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
  const [api, setApiState] = useState<ApiSettings | null>(null);
  const [judgePrompt, setJudgePrompt] = useState("");
  const [defaultJudgePrompt, setDefaultJudgePrompt] = useState("");
  const [promptVer, setPromptVer] = useState(1);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [sel, setSel] = useState<string[]>([]);
  const [repeats, setRepeats] = useState(3);
  const saveTimer = useRef<number | null>(null);
  const apiTimer = useRef<number | null>(null);

  const run = runs.length ? runs[runs.length - 1] : null;
  const active = prompts.filter((p) => p.active);
  const requests = active.length * sel.length * repeats;

  const withDate = (r: Run): Run => ({
    ...r,
    at: new Date(r.started_at).toLocaleDateString("ru-RU", { day: "numeric", month: "long" }),
  });

  useEffect(() => {
    req("/api/brand").then(setBrandState).catch(console.error);
    req("/api/facts").then(setFacts).catch(console.error);
    req("/api/prompts").then(setPrompts).catch(console.error);
    req("/api/runs")
      .then((list: Run[]) => setRuns(list.map(withDate)))
      .catch(console.error);
    req("/api/settings")
      .then((s: ApiSettings & { judgePrompt: string; judgePromptVersion: number; defaultJudgePrompt: string }) => {
        setApiState(s);
        setJudgePrompt(s.judgePrompt);
        setDefaultJudgePrompt(s.defaultJudgePrompt);
        setPromptVer(s.judgePromptVersion);
        setSel(s.models.map((m) => m.id));
      })
      .catch(console.error);
  }, []);

  // Пока прогон идёт, спрашиваем сервер о прогрессе
  useEffect(() => {
    if (!activeRun || activeRun.status !== "running") return;
    const timer = window.setInterval(() => {
      req(`/api/runs/${activeRun.id}`)
        .then((r: Run) => {
          const fresh = withDate(r);
          setActiveRun(fresh);
          if (r.status !== "running") {
            setRuns((prev) => {
              const rest = prev.filter((x) => x.id !== fresh.id);
              return [...rest, fresh];
            });
            setActiveRun(null);
            setTab("dash");
          }
        })
        .catch(console.error);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [activeRun]);

  function setApi(next: ApiSettings) {
    setApiState(next);
    if (apiTimer.current) window.clearTimeout(apiTimer.current);
    apiTimer.current = window.setTimeout(() => {
      req("/api/settings", send("PUT", next)).catch(console.error);
    }, 400);
  }

  const saveJudge = (text: string) =>
    req("/api/judge-prompt", send("PUT", { text }))
      .then((r: { version: number; text: string }) => {
        setJudgePrompt(r.text);
        setPromptVer(r.version);
      })
      .catch(console.error);

  const startRun = () =>
    req("/api/runs", send("POST", { models: sel, repeats }))
      .then((r: Run) => {
        const fresh = withDate(r);
        setRuns((prev) => [...prev, fresh]);
        setActiveRun(fresh);
      })
      .catch(console.error);

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

  if (!brand || !api) return null;

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
        {/* Дашборд и Ответы появятся на шаге 6 */}
        {tab === "run" && (
          <RunConfig
            sel={sel}
            setSel={setSel}
            repeats={repeats}
            setRepeats={setRepeats}
            prompts={active}
            requests={activeRun ? activeRun.planned : requests}
            progress={activeRun ? activeRun.done : null}
            onRun={startRun}
            api={api}
            promptVer={promptVer}
            onGo={setTab}
          />
        )}
        {tab === "settings" && (
          <Settings
            api={api}
            setApi={setApi}
            judgePrompt={judgePrompt}
            saveJudge={saveJudge}
            promptVer={promptVer}
            defaultJudgePrompt={defaultJudgePrompt}
          />
        )}
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
