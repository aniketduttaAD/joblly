import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import {
  clearAiKeysCookieOnly,
  createAiKeysCookie,
  createAiPrefCookie,
  encryptAiKeysBlob,
  getAiCookieSecretForEncryption,
  isAiEncryptionConfigured,
  readAiKeysFromCookieHeader,
  readAiPrefFromCookieHeader,
  type AiKeysPayload,
  type AiPrefPayload,
  type AiProviderId,
} from "@/lib/server/ai-cookies";

const DEFAULT_PREF: AiPrefPayload = { useSystemAi: true, provider: "openai" };

function appendSetCookies(res: NextResponse, cookies: string[]) {
  for (const c of cookies) {
    res.headers.append("Set-Cookie", c);
  }
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const user = await getUserFromRequest(req);
  if (!user) {
    return json(req, { error: "Authentication required" }, { status: 401 });
  }

  const pref = readAiPrefFromCookieHeader(req.headers.get("cookie")) ?? DEFAULT_PREF;
  const secret = getAiCookieSecretForEncryption();
  let hasOpenAiKey = false;
  let hasGeminiKey = false;
  if (secret) {
    const keys = readAiKeysFromCookieHeader(req.headers.get("cookie"), secret);
    hasOpenAiKey = Boolean(keys?.openaiKey?.trim());
    hasGeminiKey = Boolean(keys?.geminiKey?.trim());
  }

  return json(req, {
    useSystemAi: pref.useSystemAi,
    provider: pref.provider,
    hasOpenAiKey,
    hasGeminiKey,
    encryptionConfigured: isAiEncryptionConfigured(),
  });
}

function parseProvider(value: unknown): AiProviderId {
  return value === "gemini" ? "gemini" : "openai";
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const user = await getUserFromRequest(req);
  if (!user) {
    return json(req, { error: "Authentication required" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  const useSystemAi = Boolean(body.useSystemAi);
  const provider = parseProvider(body.provider);
  const openaiKeyIn = body.openaiKey;
  const geminiKeyIn = body.geminiKey;

  const pref: AiPrefPayload = { useSystemAi, provider };
  const prefCookie = createAiPrefCookie(pref);

  const secret = getAiCookieSecretForEncryption();
  const existingKeys = secret
    ? readAiKeysFromCookieHeader(req.headers.get("cookie"), secret)
    : null;

  const setCookies: string[] = [prefCookie];

  if (useSystemAi) {
    setCookies.push(clearAiKeysCookieOnly());
    const res = json(req, { ok: true });
    appendSetCookies(res, setCookies);
    return res;
  }

  if (!secret) {
    return json(
      req,
      {
        error:
          "Server is not configured to store personal API keys (AI_COOKIE_SECRET). Use system keys or contact the admin.",
      },
      { status: 503 }
    );
  }

  const nextKeys: AiKeysPayload = {
    openaiKey:
      openaiKeyIn === undefined
        ? existingKeys?.openaiKey
        : typeof openaiKeyIn === "string"
          ? openaiKeyIn.trim() || undefined
          : existingKeys?.openaiKey,
    geminiKey:
      geminiKeyIn === undefined
        ? existingKeys?.geminiKey
        : typeof geminiKeyIn === "string"
          ? geminiKeyIn.trim() || undefined
          : existingKeys?.geminiKey,
  };

  const encrypted = encryptAiKeysBlob(secret, nextKeys);
  setCookies.push(createAiKeysCookie(encrypted));

  const res = json(req, { ok: true });
  appendSetCookies(res, setCookies);
  return res;
}
