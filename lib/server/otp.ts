import crypto from "node:crypto";
import type { NextRequest } from "next/server";
import { isApiAuthorized } from "./authz";
import { getSql } from "./neon";

export const OTP_LENGTH = 4;
export const OTP_EXPIRY_MINUTES = 10;

export type RateLimitConfig = {
  maxAttempts: number;
  windowMinutes: number;
  blockMinutes: number;
};

export function assertPublicAuthRequest(req: NextRequest): void {
  if (!isApiAuthorized(req)) {
    throw new Error("FORBIDDEN");
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function isValidOtpCode(code: string): boolean {
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(code.trim());
}

export function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  const n = crypto.randomInt(0, max);
  return n.toString().padStart(OTP_LENGTH, "0");
}

export async function hashCode(code: string, salt: string): Promise<string> {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left);
  const rightBuf = Buffer.from(right);
  if (leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

export function getClientIp(req: NextRequest): string {
  const headerValue =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("fly-client-ip") ??
    "";
  const first = headerValue.split(",")[0]?.trim() ?? "";
  return first.slice(0, 128);
}

export async function getLatestOtpRow(email: string): Promise<{
  id: string;
  email: string;
  code_hash: string;
  salt: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  blocked_until: string | null;
} | null> {
  const sql = getSql();
  const rows =
    (await sql`select * from public.email_otps where email = ${email} order by created_at desc limit 1`) as Array<{
      id: string;
      email: string;
      code_hash: string;
      salt: string;
      attempts: number;
      max_attempts: number;
      expires_at: string;
      blocked_until: string | null;
      created_at: string;
    }>;
  return rows[0] ?? null;
}

export async function deleteOtpRows(email: string): Promise<void> {
  const sql = getSql();
  await sql`delete from public.email_otps where email = ${email}`;
}

export async function saveOtpRow(
  email: string,
  payload: {
    codeHash: string;
    salt: string;
    expiresAt: string;
    maxAttempts: number;
  }
): Promise<void> {
  const sql = getSql();
  await sql`
    insert into public.email_otps (email, code_hash, salt, attempts, max_attempts, expires_at, blocked_until, window_start, send_count)
    values (${email}, ${payload.codeHash}, ${payload.salt}, 0, ${payload.maxAttempts}, ${payload.expiresAt}, null, now(), 1)
    on conflict (email) do update set
      code_hash = excluded.code_hash,
      salt = excluded.salt,
      attempts = 0,
      max_attempts = excluded.max_attempts,
      expires_at = excluded.expires_at,
      blocked_until = null,
      window_start = now(),
      send_count = public.email_otps.send_count + 1
  `;
}

export async function incrementOtpAttempt(row: {
  id: string;
  attempts: number;
  max_attempts: number;
}): Promise<number> {
  const sql = getSql();
  const nextAttempts = (row.attempts ?? 0) + 1;
  const isBlocked = nextAttempts >= (row.max_attempts ?? 5);
  const blockedUntil = isBlocked ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null;
  await sql`update public.email_otps set attempts = ${nextAttempts}, blocked_until = ${blockedUntil} where id = ${row.id}`;
  return nextAttempts;
}

async function getRateLimitRow(
  action: string,
  scope: string,
  scopeKey: string
): Promise<{
  action: string;
  scope: string;
  scope_key: string;
  attempts: number;
  window_started_at: string;
  blocked_until: string | null;
} | null> {
  if (!scopeKey) return null;
  const sql = getSql();
  const rows =
    (await sql`select action, scope, scope_key, attempts, window_started_at, blocked_until from public.auth_rate_limits
    where action = ${action} and scope = ${scope} and scope_key = ${scopeKey}
    limit 1`) as Array<{
      action: string;
      scope: string;
      scope_key: string;
      attempts: number;
      window_started_at: string;
      blocked_until: string | null;
    }>;
  return rows[0] ?? null;
}

async function upsertRateLimitRow(row: {
  action: string;
  scope: string;
  scope_key: string;
  attempts: number;
  window_started_at: string;
  blocked_until: string | null;
}): Promise<void> {
  const sql = getSql();
  await sql`
    insert into public.auth_rate_limits (action, scope, scope_key, attempts, window_started_at, blocked_until)
    values (${row.action}, ${row.scope}, ${row.scope_key}, ${row.attempts}, ${row.window_started_at}, ${row.blocked_until})
    on conflict (action, scope, scope_key) do update set
      attempts = excluded.attempts,
      window_started_at = excluded.window_started_at,
      blocked_until = excluded.blocked_until,
      updated_at = now()
  `;
}

export async function checkRateLimit(
  action: string,
  scope: string,
  scopeKey: string,
  config: RateLimitConfig
): Promise<{ limited: boolean; retryAfterSeconds: number }> {
  if (!scopeKey) return { limited: false, retryAfterSeconds: 0 };
  const row = await getRateLimitRow(action, scope, scopeKey);
  if (!row) return { limited: false, retryAfterSeconds: 0 };

  const now = new Date();
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
  if (blockedUntil && !Number.isNaN(blockedUntil.getTime()) && blockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)),
    };
  }

  const windowStartedAt = row.window_started_at ? new Date(row.window_started_at) : null;
  const windowExpired =
    !windowStartedAt ||
    Number.isNaN(windowStartedAt.getTime()) ||
    now.getTime() - windowStartedAt.getTime() >= config.windowMinutes * 60_000;

  if (windowExpired) {
    await upsertRateLimitRow({
      ...row,
      attempts: 0,
      blocked_until: null,
      window_started_at: now.toISOString(),
    });
    return { limited: false, retryAfterSeconds: 0 };
  }

  if ((row.attempts ?? 0) < config.maxAttempts) {
    return { limited: false, retryAfterSeconds: 0 };
  }

  const nextBlockedUntil = new Date(now.getTime() + config.blockMinutes * 60_000);
  await upsertRateLimitRow({ ...row, blocked_until: nextBlockedUntil.toISOString() });
  return {
    limited: true,
    retryAfterSeconds: Math.max(1, Math.ceil((nextBlockedUntil.getTime() - now.getTime()) / 1000)),
  };
}

export async function incrementRateLimit(
  action: string,
  scope: string,
  scopeKey: string,
  config: RateLimitConfig
): Promise<void> {
  if (!scopeKey) return;
  const now = new Date();
  const current = await getRateLimitRow(action, scope, scopeKey);

  const windowStartedAt = current?.window_started_at ? new Date(current.window_started_at) : null;
  const windowExpired =
    !windowStartedAt ||
    Number.isNaN(windowStartedAt.getTime()) ||
    now.getTime() - windowStartedAt.getTime() >= config.windowMinutes * 60_000;

  const attempts = windowExpired ? 1 : (current?.attempts ?? 0) + 1;
  const blockedUntil =
    attempts >= config.maxAttempts
      ? new Date(now.getTime() + config.blockMinutes * 60_000).toISOString()
      : null;

  await upsertRateLimitRow({
    action,
    scope,
    scope_key: scopeKey,
    attempts,
    blocked_until: blockedUntil,
    window_started_at: windowExpired
      ? now.toISOString()
      : (current?.window_started_at ?? now.toISOString()),
  });
}

export async function clearRateLimit(
  action: string,
  scope: string,
  scopeKey: string
): Promise<void> {
  if (!scopeKey) return;
  const sql = getSql();
  await sql`delete from public.auth_rate_limits where action = ${action} and scope = ${scope} and scope_key = ${scopeKey}`;
}
