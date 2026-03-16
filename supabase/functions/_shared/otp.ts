import { createAdminClient, isApiAuthorized } from "./auth.ts";

export const OTP_LENGTH = 4;
export const OTP_EXPIRY_MINUTES = 10;

export type OtpRow = {
  id: string;
  email: string;
  code_hash: string;
  salt: string;
  attempts: number;
  max_attempts: number;
  expires_at: string;
  created_at: string;
  send_count?: number;
  window_start?: string;
  blocked_until?: string | null;
};

export type RateLimitConfig = {
  maxAttempts: number;
  windowMinutes: number;
  blockMinutes: number;
};

type RateLimitRow = {
  action: string;
  scope: string;
  scope_key: string;
  attempts: number;
  window_started_at: string;
  blocked_until: string | null;
};

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function assertPublicAuthRequest(req: Request): void {
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
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(OTP_LENGTH, "0");
}

export async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}

export function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;

  for (let i = 0; i < maxLength; i += 1) {
    diff |= (leftBytes[i] ?? 0) ^ (rightBytes[i] ?? 0);
  }

  return diff === 0;
}

export function getClientIp(req: Request): string {
  const headerValue =
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    req.headers.get("fly-client-ip") ??
    "";
  const first = headerValue.split(",")[0]?.trim() ?? "";
  return first.slice(0, 128);
}

export async function getLatestOtpRow(email: string): Promise<OtpRow | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .order("created_at", { ascending: false })
    .limit(10);

  if (error) throw error;

  const rows = (data ?? []) as OtpRow[];
  const [latest, ...stale] = rows;
  if (stale.length > 0) {
    const staleIds = stale.map((row) => row.id).filter(Boolean);
    if (staleIds.length > 0) {
      await supabase
        .from("email_otps")
        .delete()
        .in("id", staleIds)
        .catch(() => {});
    }
  }

  return latest ?? null;
}

export async function deleteOtpRows(email: string): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("email_otps")
    .delete()
    .eq("email", email)
    .catch(() => {});
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
  const supabase = createAdminClient();
  const existing = await getLatestOtpRow(email);
  const nowIso = new Date().toISOString();

  const row = {
    email,
    code_hash: payload.codeHash,
    salt: payload.salt,
    attempts: 0,
    max_attempts: payload.maxAttempts,
    expires_at: payload.expiresAt,
    blocked_until: null,
    window_start: nowIso,
    send_count: existing ? (existing.send_count ?? 0) + 1 : 1,
  };

  if (existing?.id) {
    const { error } = await supabase.from("email_otps").update(row).eq("id", existing.id);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("email_otps").insert(row);
  if (error) throw error;
}

export async function incrementOtpAttempt(row: OtpRow): Promise<number> {
  const supabase = createAdminClient();
  const nextAttempts = (row.attempts ?? 0) + 1;
  const isBlocked = nextAttempts >= (row.max_attempts ?? 5);
  const { error } = await supabase
    .from("email_otps")
    .update({
      attempts: nextAttempts,
      blocked_until: isBlocked ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null,
    })
    .eq("id", row.id);
  if (error) throw error;
  return nextAttempts;
}

async function getRateLimitRow(
  action: string,
  scope: string,
  scopeKey: string
): Promise<RateLimitRow | null> {
  if (!scopeKey) return null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("auth_rate_limits")
      .select("*")
      .eq("action", action)
      .eq("scope", scope)
      .eq("scope_key", scopeKey)
      .limit(1);

    if (error) throw error;
    return ((data ?? [])[0] as RateLimitRow | undefined) ?? null;
  } catch (error) {
    console.error("otp rate-limit read error:", error);
    return null;
  }
}

async function upsertRateLimitRow(row: RateLimitRow): Promise<void> {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("auth_rate_limits").upsert(row, {
      onConflict: "action,scope,scope_key",
    });
    if (error) throw error;
  } catch (error) {
    console.error("otp rate-limit write error:", error);
  }
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
  const blockedUntil = parseDate(row.blocked_until);
  if (blockedUntil && blockedUntil > now) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000)),
    };
  }

  const windowStartedAt = parseDate(row.window_started_at);
  const windowExpired =
    !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= config.windowMinutes * 60_000;

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
  await upsertRateLimitRow({
    ...row,
    blocked_until: nextBlockedUntil.toISOString(),
  });

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
  const windowStartedAt = parseDate(current?.window_started_at);
  const windowExpired =
    !windowStartedAt || now.getTime() - windowStartedAt.getTime() >= config.windowMinutes * 60_000;
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

  try {
    const supabase = createAdminClient();
    await supabase
      .from("auth_rate_limits")
      .delete()
      .eq("action", action)
      .eq("scope", scope)
      .eq("scope_key", scopeKey)
      .catch(() => {});
  } catch (error) {
    console.error("otp rate-limit clear error:", error);
  }
}
