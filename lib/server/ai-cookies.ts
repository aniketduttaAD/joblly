import crypto from "node:crypto";
import { buildHttpOnlyCookie, parseCookieHeader } from "@/lib/server/auth";

export const AI_PREF_COOKIE_NAME = "jobtracker_ai_pref";
export const AI_KEYS_COOKIE_NAME = "jobtracker_ai_keys";

export type AiProviderId = "openai" | "gemini";

export type AiPrefPayload = {
  useSystemAi: boolean;
  provider: AiProviderId;
};

export type AiKeysPayload = {
  openaiKey?: string;
  geminiKey?: string;
};

const COOKIE_MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

function getEncryptionKey(secret: string): Buffer {
  return crypto.createHash("sha256").update(secret, "utf8").digest();
}

function getAiCookieSecret(): string {
  return (process.env.AI_COOKIE_SECRET ?? "").trim();
}

export function encryptAiKeysBlob(secret: string, payload: AiKeysPayload): string {
  const key = getEncryptionKey(secret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, ciphertext, tag]);
  return combined.toString("base64url");
}

export function decryptAiKeysBlob(secret: string, blob: string): AiKeysPayload | null {
  try {
    const key = getEncryptionKey(secret);
    const raw = Buffer.from(blob, "base64url");
    if (raw.length < 12 + 16 + 1) return null;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(raw.length - 16);
    const ciphertext = raw.subarray(12, raw.length - 16);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    const parsed = JSON.parse(plain.toString("utf8")) as AiKeysPayload;
    if (!parsed || typeof parsed !== "object") return null;
    return {
      openaiKey: typeof parsed.openaiKey === "string" ? parsed.openaiKey : undefined,
      geminiKey: typeof parsed.geminiKey === "string" ? parsed.geminiKey : undefined,
    };
  } catch {
    return null;
  }
}

export function serializePref(pref: AiPrefPayload): string {
  return JSON.stringify({
    useSystemAi: Boolean(pref.useSystemAi),
    provider: pref.provider === "gemini" ? "gemini" : "openai",
  });
}

export function parsePrefCookie(value: string | undefined): AiPrefPayload | null {
  if (!value?.trim()) return null;
  try {
    const parsed = JSON.parse(value) as { useSystemAi?: unknown; provider?: unknown };
    const provider = parsed.provider === "gemini" ? "gemini" : "openai";
    return {
      useSystemAi: Boolean(parsed.useSystemAi),
      provider,
    };
  } catch {
    return null;
  }
}

export function readAiPrefFromCookieHeader(cookieHeader: string | null): AiPrefPayload | null {
  const cookies = parseCookieHeader(cookieHeader);
  return parsePrefCookie(cookies[AI_PREF_COOKIE_NAME]);
}

export function readAiKeysFromCookieHeader(
  cookieHeader: string | null,
  secret: string
): AiKeysPayload | null {
  const cookies = parseCookieHeader(cookieHeader);
  const blob = cookies[AI_KEYS_COOKIE_NAME];
  if (!blob?.trim() || !secret) return null;
  return decryptAiKeysBlob(secret, blob);
}

export function createAiPrefCookie(pref: AiPrefPayload): string {
  return buildHttpOnlyCookie(AI_PREF_COOKIE_NAME, serializePref(pref), {
    maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
  });
}

export function createAiKeysCookie(encryptedBlob: string): string {
  return buildHttpOnlyCookie(AI_KEYS_COOKIE_NAME, encryptedBlob, {
    maxAgeSeconds: COOKIE_MAX_AGE_SECONDS,
  });
}

export function clearAiKeysCookieOnly(): string {
  return buildHttpOnlyCookie(AI_KEYS_COOKIE_NAME, "", { expireNow: true });
}

export function clearAiCookies(): string[] {
  return [
    buildHttpOnlyCookie(AI_PREF_COOKIE_NAME, "", { expireNow: true }),
    buildHttpOnlyCookie(AI_KEYS_COOKIE_NAME, "", { expireNow: true }),
  ];
}

export function isAiEncryptionConfigured(): boolean {
  return getAiCookieSecret().length > 0;
}

export function getAiCookieSecretForEncryption(): string | null {
  const s = getAiCookieSecret();
  return s.length ? s : null;
}
