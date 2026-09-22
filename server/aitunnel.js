import 'dotenv/config';

// Клиент шлюза AITunnel. Формат OpenAI Chat Completions.
// Ключ читается только здесь, на бэкенде, и наружу не отдаётся.

export const BASE_URL = (process.env.AITUNNEL_BASE_URL || 'https://api.aitunnel.ru/v1').replace(/\/+$/, '');

const MAX_RETRIES = 3;      // до 3 повторов на 429 (CLAUDE.md)
const BASE_DELAY_MS = 500;  // экспоненциальная задержка: 500, 1000, 2000
const TIMEOUT_MS = 120000;
const SOURCE_CONTENT_LIMIT = 2000; // фрагмент страницы: столько хранится и ищется

export class GatewayError extends Error {
  constructor(message, { status = null, body = null, code = null } = {}) {
    super(message);
    this.name = 'GatewayError';
    this.status = status;
    this.body = body;
    this.code = code;
  }
}

export function apiKey() {
  return (process.env.AITUNNEL_API_KEY || '').trim();
}

export function keyInfo() {
  const key = apiKey();
  return {
    key_configured: key.length > 0,
    key_last4: key.length >= 4 ? key.slice(-4) : null,
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Пауза между запросами внутри прогона: 200–300 мс (CLAUDE.md)
export const gap = () => sleep(200 + Math.floor(Math.random() * 100));

function checkModel(model) {
  const m = String(model || '').trim();
  if (!m) throw new GatewayError('Не указана модель.', { code: 'no_model' });
  // Запрещено: подмена модели ломает сопоставимость замеров
  if (m.toLowerCase() === 'auto') {
    throw new GatewayError('Модель auto запрещена: шлюз подставит произвольную модель и замеры перестанут быть сравнимыми.', { code: 'auto_model' });
  }
  if (/(^|[-:/])latest$/i.test(m)) {
    throw new GatewayError(`Плавающий алиас «${m}» запрещён: под ним модель молча обновится и скачок метрики будет не отличить от реального изменения. Укажите точную версию.`, { code: 'floating_alias' });
  }
  return m;
}

/**
 * Один запрос к модели через шлюз.
 * Запасные модели (fallback) не включаются никогда — в отчёт попали бы ответы не той модели.
 */
export async function chat({ model, messages, maxTokens, temperature, responseFormat, webSearch }) {
  const key = apiKey();
  if (!key) {
    throw new GatewayError('Ключ AITUNNEL_API_KEY не задан в файле .env на бэкенде.', { code: 'no_key' });
  }
  const exactModel = checkModel(model);

  // max_tokens обязателен: по нему шлюз резервирует стоимость
  const limit = Number(maxTokens);
  if (!Number.isFinite(limit) || limit <= 0) {
    throw new GatewayError('Не задан max_tokens — по нему шлюз резервирует стоимость запроса.', { code: 'no_max_tokens' });
  }

  const body = { model: exactModel, messages, max_tokens: Math.round(limit) };
  if (temperature !== undefined) body.temperature = temperature;
  if (responseFormat) body.response_format = responseFormat;

  // Веб-поиск: серверный инструмент шлюза. Тарифицируется за фактические
  // вызовы, поэтому число поисков и результатов ограничиваем явно.
  if (webSearch) {
    const parameters = {};
    if (webSearch.engine && webSearch.engine !== 'auto') parameters.engine = webSearch.engine;
    if (webSearch.maxResults) parameters.max_results = Number(webSearch.maxResults);
    if (webSearch.maxUses) parameters.max_uses = Number(webSearch.maxUses);
    if (webSearch.maxTotalResults) parameters.max_total_results = Number(webSearch.maxTotalResults);
    body.tools = [
      Object.keys(parameters).length
        ? { type: 'aitunnel:web_search', parameters }
        : { type: 'aitunnel:web_search' },
    ];
  }

  let lastError = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));

    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const timedOut = e && e.name === 'AbortError';
      throw new GatewayError(
        timedOut ? 'Шлюз не ответил за 2 минуты.' : `Не удалось связаться со шлюзом: ${e && e.message ? e.message : e}`,
        { code: timedOut ? 'timeout' : 'network' }
      );
    }
    clearTimeout(timer);

    const latencyMs = Date.now() - started;
    const rawText = await res.text();

    if (!res.ok) {
      // 429 прилетает от провайдеров — повторяем; остальные коды повторять бессмысленно
      if (res.status === 429 && attempt < MAX_RETRIES) {
        lastError = new GatewayError('Провайдер ограничил частоту запросов (429).', { status: 429, body: rawText, code: 'rate_limit' });
        continue;
      }
      throw new GatewayError(gatewayMessage(res.status, rawText), { status: res.status, body: rawText, code: 'http_error' });
    }

    let data;
    try {
      data = JSON.parse(rawText);
    } catch {
      throw new GatewayError('Шлюз вернул не JSON.', { status: res.status, body: rawText.slice(0, 2000), code: 'bad_json' });
    }

    const choice = (data.choices && data.choices[0]) || null;
    const message = (choice && choice.message) || null;
    const text = (message && message.content) || '';
    const usage = data.usage || null;

    // Источники из веб-поиска. Если модель искать не стала, аннотаций не будет вовсе.
    const sources = sourcesOf(message);

    return {
      model_requested: exactModel,
      model_returned: data.model || null,
      text,
      latency_ms: latencyMs,
      cost_rub: usage && usage.cost_rub !== undefined ? usage.cost_rub : null,
      usage,
      finish_reason: choice ? choice.finish_reason : null,
      sources,
      // Сколько раз модель реально искала. Часть провайдеров поле не возвращает
      web_search_requests:
        usage && usage.server_tool_use && usage.server_tool_use.web_search_requests !== undefined
          ? usage.server_tool_use.web_search_requests
          : null,
      raw: data,
    };
  }

  throw lastError || new GatewayError('Запрос к шлюзу не удался.', { code: 'unknown' });
}

/**
 * Источники из аннотаций ответа. Отдельной функцией, потому что её же вызывает
 * дозаполнение архива: разбор уже сохранённых сырых ответов идёт тем же путём,
 * что и разбор свежего — иначе старые и новые прогоны разъедутся.
 */
export function sourcesOf(message) {
  const annotations = Array.isArray(message && message.annotations) ? message.annotations : [];
  return annotations
    .filter((a) => a && a.type === 'url_citation' && a.url_citation && a.url_citation.url)
    .map((a, i) => ({
      url: String(a.url_citation.url),
      title: a.url_citation.title ? String(a.url_citation.title) : null,
      domain: domainOf(a.url_citation.url),
      position: i + 1,
      // Фрагмент процитированной страницы. По нему считается, назван ли бренд
      // на самом сайте, а не просто в ответе модели. Длину ограничиваем:
      // в базе и в ответе API нам нужен кусок для поиска, а не копия страницы
      content: a.url_citation.content ? String(a.url_citation.content).slice(0, SOURCE_CONTENT_LIMIT) : null,
    }));
}

/** Домен источника — по нему строится сводка по источникам */
export function domainOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function gatewayMessage(status, rawText) {
  let detail = '';
  try {
    const j = JSON.parse(rawText);
    detail = (j.error && (j.error.message || j.error.code)) || j.message || '';
  } catch {
    detail = String(rawText || '').slice(0, 300);
  }
  const known = {
    401: 'Шлюз не принял ключ (401). Проверьте AITUNNEL_API_KEY в .env.',
    403: 'Шлюз отказал в доступе (403).',
    404: 'Шлюз не знает такой модели или адреса (404). Сверьте строку модели с каталогом шлюза.',
    402: 'Недостаточно средств на балансе шлюза (402).',
    429: 'Провайдер ограничил частоту запросов (429), повторы не помогли.',
  };
  const head = known[status] || `Шлюз ответил ошибкой ${status}.`;
  return detail ? `${head} ${detail}` : head;
}
