// Стартовые значения — из прототипа (prototype/ai-brand-monitor.jsx).
// Строки моделей позже переедут в базу и будут правиться на экране «Подключение».

export const SEED_MODELS = [
  { id: 'gpt', name: 'ChatGPT', api: 'gpt-5.6-sol' },
  { id: 'gem', name: 'Gemini', api: 'gemini-3.7-flash' },
  { id: 'cld', name: 'Claude', api: 'claude-sonnet-4.6' },
];

export const SEED_JUDGE_MODEL = 'gemini-3.8-flash';
export const SEED_MAX_TOKENS = 1500;
