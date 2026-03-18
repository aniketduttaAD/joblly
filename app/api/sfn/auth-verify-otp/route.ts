import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { createAppJwt, createSessionCookies } from "@/lib/server/auth";
import { getSql } from "@/lib/server/neon";
import {
  OTP_LENGTH,
  assertPublicAuthRequest,
  checkRateLimit,
  clearRateLimit,
  deleteOtpRows,
  getClientIp,
  getLatestOtpRow,
  hashCode,
  incrementOtpAttempt,
  incrementRateLimit,
  isValidEmail,
  isValidOtpCode,
  normalizeEmail,
  timingSafeEqual,
} from "@/lib/server/otp";

const VERIFY_LIMITS = {
  email: { maxAttempts: 7, windowMinutes: 15, blockMinutes: 30 },
  ip: { maxAttempts: 25, windowMinutes: 15, blockMinutes: 30 },
} as const;

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  try {
    assertPublicAuthRequest(req);
  } catch {
    return json(req, { error: "Forbidden" }, { status: 403 });
  }

  let body: { email?: string; code?: string };
  try {
    body = (await req.json()) as { email?: string; code?: string };
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  const code = (body.code ?? "").trim();
  const ip = getClientIp(req);

  if (!email) return json(req, { error: "Email is required." }, { status: 400 });
  if (!isValidEmail(email))
    return json(req, { error: "Enter a valid email address." }, { status: 400 });
  if (!isValidOtpCode(code)) {
    return json(
      req,
      { error: `Enter the ${OTP_LENGTH}-digit code from your email.` },
      { status: 400 }
    );
  }

  const emailLimit = await checkRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
  if (emailLimit.limited) {
    return json(
      req,
      { error: "Too many incorrect code attempts for this email. Please wait and try again." },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
    );
  }

  const ipLimit = await checkRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);
  if (ipLimit.limited) {
    return json(
      req,
      { error: "Too many OTP verification attempts from this network. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  let row;
  try {
    row = await getLatestOtpRow(email);
  } catch (error) {
    console.error("auth-verify-otp select error:", error);
    return json(
      req,
      { error: "Unable to verify the code right now. Please try again." },
      { status: 500 }
    );
  }

  if (!row) {
    await incrementRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
    await incrementRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);
    return json(
      req,
      { error: "This code has expired. Request a new one and try again." },
      { status: 401 }
    );
  }

  const now = new Date();
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
  if (blockedUntil && !Number.isNaN(blockedUntil.getTime()) && blockedUntil > now) {
    return json(
      req,
      { error: "Too many incorrect code attempts. Request a new code or try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(
            Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000))
          ),
        },
      }
    );
  }

  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    await deleteOtpRows(email);
    return json(
      req,
      { error: "This code has expired. Request a new one and try again." },
      { status: 401 }
    );
  }

  const computedHash = await hashCode(code, row.salt);
  const isMatch = timingSafeEqual(computedHash, row.code_hash);

  if (!isMatch) {
    try {
      const nextAttempts = await incrementOtpAttempt({
        id: row.id,
        attempts: row.attempts,
        max_attempts: row.max_attempts,
      });
      await incrementRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
      await incrementRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);

      const attemptsRemaining = Math.max(0, (row.max_attempts ?? 5) - nextAttempts);
      if (attemptsRemaining === 0) {
        return json(
          req,
          { error: "Incorrect code. You have reached the maximum attempts. Request a new code." },
          { status: 401 }
        );
      }
      return json(
        req,
        {
          error: `Incorrect code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`,
        },
        { status: 401 }
      );
    } catch (error) {
      console.error("auth-verify-otp update error:", error);
      return json(
        req,
        { error: "Unable to verify the code right now. Please try again." },
        { status: 500 }
      );
    }
  }

  await deleteOtpRows(email);
  await clearRateLimit("verify_otp", "email", email);
  await clearRateLimit("verify_otp", "ip", ip);

  const sql = getSql();
  const existingRows = (await sql`
    select id, email, name from public.app_users where email = ${email} order by created_at asc limit 1
  `) as Array<{ id: string; email: string; name: string | null }>;
  const existingUser = existingRows[0] ?? null;

  let userId: string;
  let name: string | null = null;

  if (existingUser) {
    userId = existingUser.id;
    name = existingUser.name ?? null;
  } else {
    userId = crypto.randomUUID();
    await sql`
      insert into public.app_users (id, email, name)
      values (${userId}, ${email}, null)
      on conflict (id) do update set email = excluded.email, name = excluded.name, updated_at = now()
    `;
  }

  let accessToken: string;
  let refreshToken: string;
  try {
    accessToken = await createAppJwt({ sub: userId, email }, 5 * 60, "access");
    refreshToken = await createAppJwt({ sub: userId, email }, 7 * 24 * 60 * 60, "refresh");
  } catch (err) {
    console.error("auth-verify-otp jwt error:", err);
    return json(
      req,
      { error: "Unable to finish sign-in right now. Please try again." },
      { status: 500 }
    );
  }

  const res = json(req, { id: userId, email, name, token: accessToken });
  for (const cookie of createSessionCookies({ accessToken, refreshToken })) {
    res.headers.append("Set-Cookie", cookie);
  }
  return res;
}
