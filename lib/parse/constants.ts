export const JD_PARSE_MODEL = "gpt-4o-mini";
export const MAX_JD_CHARS = 60_000;
export const OPENAI_TIMEOUT_MS = 45_000;
export const MAX_RETRIES = 2;
export const BASE_RETRY_DELAY_MS = 1000;
export const MAX_TOKENS_RESPONSE = 4000;
export const EXCHANGE_RATE_TIMEOUT_MS = 5000;
export const EXCHANGE_RATE_CACHE_TTL_MS = 3600_000;
export const SALARY_ESTIMATE_TIMEOUT_MS = 10000;

export const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  USD: 83.5,
  EUR: 90.2,
  GBP: 105.3,
  CAD: 61.5,
  AUD: 54.8,
  SGD: 61.2,
  JPY: 0.56,
  CHF: 93.5,
};
