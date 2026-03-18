import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { getAllowedOrigins } from "./cors";
import { getSql } from "./neon";

export interface AuthenticatedUserIdentity {
  userId: string;
  email: string;
  name?: string | null;
}

export type AppJwtType = "access" | "refresh";

export const ACCESS_COOKIE_NAME = "jobtracker_access";
export const REFRESH_COOKIE_NAME = "jobtracker_refresh";
export const LEGACY_SESSION_COOKIE_NAME = "jobtracker_session";

export function getAppJwtSecret(): string {
  const secret = (process.env.APP_JWT_SECRET ?? "").trim() || (process.env.API_KEY ?? "").trim();

  if (!secret) {
    throw new Error("APP_JWT_SECRET is not configured");
  }

  return secret;
}

function base64UrlEncode(data: Buffer): string {
  return data.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const pad = 4 - (input.length % 4 || 4);
  const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
  return Buffer.from(base64, "base64");
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookieHeader = header ?? "";
  if (!cookieHeader) return {};
  const out: Record<string, string> = {};
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    const key = (k ?? "").trim();
    if (!key) continue;
    out[key] = decodeURIComponent(v.join("="));
  }
  return out;
}

export function getAppJwtFromRequest(req: NextRequest): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim() || null;
  }

  const cookies = parseCookieHeader(req.headers.get("cookie"));
  const cookieToken = cookies[ACCESS_COOKIE_NAME] ?? cookies[LEGACY_SESSION_COOKIE_NAME];
  return cookieToken ?? null;
}

export function getRefreshTokenFromRequest(req: NextRequest): string | null {
  const cookies = parseCookieHeader(req.headers.get("cookie"));
  return cookies[REFRESH_COOKIE_NAME] ?? null;
}

export async function createAppJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number,
  type: AppJwtType
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    ...payload,
    type,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(fullPayload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const signature = crypto.createHmac("sha256", getAppJwtSecret()).update(signingInput).digest();
  const signatureB64 = base64UrlEncode(signature);

  return `${signingInput}.${signatureB64}`;
}

export async function verifyAppJwt(
  token: string,
  expectedType?: AppJwtType
): Promise<{ userId: string; email: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;
    const signingInput = `${headerB64}.${payloadB64}`;

    const expectedSig = crypto
      .createHmac("sha256", getAppJwtSecret())
      .update(signingInput)
      .digest();
    const gotSig = base64UrlDecode(signatureB64);
    if (gotSig.length !== expectedSig.length) return null;
    if (!crypto.timingSafeEqual(gotSig, expectedSig)) return null;

    const payloadJson = base64UrlDecode(payloadB64).toString("utf8");
    const payload = JSON.parse(payloadJson) as {
      sub?: string;
      email?: string;
      exp?: number;
      type?: AppJwtType;
    };
    if (!payload.sub || !payload.email) return null;
    if (typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) return null;
    }
    if (expectedType && payload.type && payload.type !== expectedType) {
      return null;
    }
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

function getPrimarySiteOrigin(): string {
  return getAllowedOrigins()[0] ?? "";
}

function buildCookie(
  name: string,
  value: string,
  options: { maxAgeSeconds?: number; expireNow?: boolean } = {}
): string {
  const siteUrl = getPrimarySiteOrigin();
  const allowedOrigins = getAllowedOrigins();
  const isLocalSite = allowedOrigins.some((o) =>
    /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(o)
  );
  const useCrossSiteCookies = !isLocalSite && siteUrl.startsWith("https://");

  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly"];
  if (options.expireNow) {
    parts.push("Max-Age=0");
  } else if (typeof options.maxAgeSeconds === "number") {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (useCrossSiteCookies) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  return parts.join("; ");
}

export function createSessionCookies(tokens: {
  accessToken: string;
  refreshToken: string;
}): string[] {
  const accessCookie = buildCookie(ACCESS_COOKIE_NAME, tokens.accessToken, {
    maxAgeSeconds: 5 * 60,
  });
  const refreshCookie = buildCookie(REFRESH_COOKIE_NAME, tokens.refreshToken, {
    maxAgeSeconds: 7 * 24 * 60 * 60,
  });
  return [accessCookie, refreshCookie];
}

export function clearSessionCookies(): string[] {
  return [
    buildCookie(ACCESS_COOKIE_NAME, "", { expireNow: true }),
    buildCookie(REFRESH_COOKIE_NAME, "", { expireNow: true }),
    buildCookie(LEGACY_SESSION_COOKIE_NAME, "", { expireNow: true }),
  ];
}

export async function getUserFromRequest(
  req: NextRequest
): Promise<AuthenticatedUserIdentity | null> {
  const token = getAppJwtFromRequest(req);
  if (!token) return null;

  const claims = await verifyAppJwt(token, "access");
  if (!claims) return null;

  const sql = getSql();
  const rows =
    (await sql`select id, email, name from public.app_users where id = ${claims.userId} limit 1`) as Array<{
      id: string;
      email: string;
      name: string | null;
    }>;
  const row = rows[0] ?? null;
  return {
    userId: claims.userId,
    email: row?.email ?? claims.email,
    name: row?.name ?? null,
  };
}
