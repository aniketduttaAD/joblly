import { ParseError, isRetryableError, isNonRetryableError } from "./errors";
import { BASE_RETRY_DELAY_MS, MAX_RETRIES } from "./constants";

export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new ParseError(errorMsg, true)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeoutPromise]);
  } catch (error) {
    if (error instanceof ParseError) {
      throw error;
    }
    throw new ParseError(errorMsg, true);
  }
}

export function normalizeString(value: unknown, required: boolean = false): string | null {
  if (value == null) return required ? "" : null;
  const s = String(value).trim();
  if (!s || s === "null" || s === "undefined") return required ? "" : null;
  return s;
}

export function capString(
  s: string | null,
  maxLen: number,
  required: boolean = false
): string | null {
  if (s == null) return required ? "" : null;
  if (s.length <= maxLen) return s;
  const capped = s.slice(0, maxLen).trim();
  return capped || (required ? "" : null);
}

export function dedupeArray(items: string[], maxLen: number = 128): string[] {
  const seen = new Set<string>();
  return items
    .map((t) => String(t).trim().slice(0, maxLen))
    .filter((s) => {
      if (!s) return false;
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeNumber(
  value: unknown,
  min: number = 0,
  max: number = 1_000_000_000
): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return Math.round(num);
}

export function extractJSON(rawContent: string): string {
  let content = rawContent.trim();

  if (content.startsWith("```")) {
    const lines = content.split("\n");
    const startIdx = lines[0].toLowerCase().includes("json") ? 1 : 0;
    const endIdx = lines[lines.length - 1].trim() === "```" ? lines.length - 1 : lines.length;
    content = lines.slice(startIdx, endIdx).join("\n").trim();
  }

  if (!content.startsWith("{")) {
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      content = content.substring(jsonStart, jsonEnd + 1);
    }
  }

  return content;
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        if (process.env.NODE_ENV === "development") {
          console.log(`[Parse] Retry attempt ${attempt} after ${delay}ms`);
        }
        await sleep(delay);
      }

      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (isNonRetryableError(lastError)) throw lastError;
      if (!isRetryableError(lastError) || attempt === maxRetries) throw lastError;

      if (process.env.NODE_ENV === "development") {
        console.error(`[Parse] Attempt ${attempt + 1} failed:`, lastError.message);
      }
    }
  }

  throw lastError || new Error("Parse failed after retries");
}
