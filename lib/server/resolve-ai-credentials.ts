import type { NextRequest } from "next/server";
import {
  getAiCookieSecretForEncryption,
  readAiKeysFromCookieHeader,
  readAiPrefFromCookieHeader,
  type AiProviderId,
} from "@/lib/server/ai-cookies";

export type ResolvedAiCreds =
  | { ok: true; provider: AiProviderId; apiKey: string }
  | { ok: false; status: number; error: string };

const DEFAULT_PREF = { useSystemAi: true as const, provider: "openai" as AiProviderId };

export function resolveAiCredentials(req: NextRequest): ResolvedAiCreds {
  const pref = readAiPrefFromCookieHeader(req.headers.get("cookie")) ?? DEFAULT_PREF;

  if (pref.useSystemAi) {
    if (pref.provider === "openai") {
      const k = (process.env.OPENAI_API_KEY ?? "").trim();
      if (!k) {
        return {
          ok: false,
          status: 503,
          error: "OpenAI is not configured on the server (missing OPENAI_API_KEY).",
        };
      }
      return { ok: true, provider: "openai", apiKey: k };
    }
    const k = (process.env.GEMINI_API_KEY ?? "").trim();
    if (!k) {
      return {
        ok: false,
        status: 503,
        error: "Gemini is not configured on the server (missing GEMINI_API_KEY).",
      };
    }
    return { ok: true, provider: "gemini", apiKey: k };
  }

  const secret = getAiCookieSecretForEncryption();
  if (!secret) {
    return {
      ok: false,
      status: 503,
      error:
        "Personal API keys are not available (server missing AI_COOKIE_SECRET). Use system keys in Settings or contact the admin.",
    };
  }

  const keys = readAiKeysFromCookieHeader(req.headers.get("cookie"), secret) ?? {};
  const apiKey =
    pref.provider === "openai" ? (keys.openaiKey ?? "").trim() : (keys.geminiKey ?? "").trim();

  if (!apiKey) {
    return {
      ok: false,
      status: 400,
      error: `Add your ${pref.provider === "openai" ? "OpenAI" : "Gemini"} API key in Settings, or turn on system keys.`,
    };
  }

  return { ok: true, provider: pref.provider, apiKey };
}
