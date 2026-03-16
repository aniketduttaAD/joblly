import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createAdminClient, getAppJwtSecret } from "../_shared/auth.ts";
import { upsertAppUser } from "../_shared/db.ts";
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
} from "../_shared/otp.ts";

const VERIFY_LIMITS = {
  email: { maxAttempts: 7, windowMinutes: 15, blockMinutes: 30 },
  ip: { maxAttempts: 25, windowMinutes: 15, blockMinutes: 30 },
} as const;

async function createJwt(
  payload: Record<string, unknown>,
  expiresInSeconds: number
): Promise<string> {
  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
  };

  const encoder = new TextEncoder();
  const base64Url = (data: Uint8Array) =>
    btoa(String.fromCharCode(...data))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

  const headerJson = encoder.encode(JSON.stringify(header));
  const payloadJson = encoder.encode(JSON.stringify(fullPayload));

  const headerB64 = base64Url(headerJson);
  const payloadB64 = base64Url(payloadJson);
  const data = encoder.encode(`${headerB64}.${payloadB64}`);

  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(getAppJwtSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
  const signatureB64 = base64Url(signature);

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

function createSessionCookie(token: string): string {
  const isProd = Deno.env.get("NODE_ENV") === "production";
  const parts = [`jobtracker_session=${token}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (isProd) {
    parts.push("Secure");
  }
  return parts.join("; ");
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  try {
    assertPublicAuthRequest(req);
  } catch {
    return errorResponse("Forbidden", 403);
  }

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = normalizeEmail(body.email ?? "");
  const code = (body.code ?? "").trim();
  const ip = getClientIp(req);

  if (!email) {
    return errorResponse("Email is required.", 400);
  }
  if (!isValidEmail(email)) {
    return errorResponse("Enter a valid email address.", 400);
  }
  if (!isValidOtpCode(code)) {
    return errorResponse(`Enter the ${OTP_LENGTH}-digit code from your email.`, 400);
  }

  const emailLimit = await checkRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
  if (emailLimit.limited) {
    return jsonResponse(
      { error: "Too many incorrect code attempts for this email. Please wait and try again." },
      429,
      { "Retry-After": String(emailLimit.retryAfterSeconds) }
    );
  }

  const ipLimit = await checkRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);
  if (ipLimit.limited) {
    return jsonResponse(
      { error: "Too many OTP verification attempts from this network. Please try again later." },
      429,
      { "Retry-After": String(ipLimit.retryAfterSeconds) }
    );
  }

  let row;
  try {
    row = await getLatestOtpRow(email);
  } catch (error) {
    console.error("auth-verify-otp select error:", error);
    return errorResponse("Unable to verify the code right now. Please try again.", 500);
  }

  if (!row) {
    await incrementRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
    await incrementRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);
    return errorResponse("This code has expired. Request a new one and try again.", 401);
  }

  const now = new Date();
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
  if (blockedUntil && !Number.isNaN(blockedUntil.getTime()) && blockedUntil > now) {
    return jsonResponse(
      { error: "Too many incorrect code attempts. Request a new code or try again later." },
      429,
      {
        "Retry-After": String(
          Math.max(1, Math.ceil((blockedUntil.getTime() - now.getTime()) / 1000))
        ),
      }
    );
  }

  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    await deleteOtpRows(email);
    return errorResponse("This code has expired. Request a new one and try again.", 401);
  }

  const computedHash = await hashCode(code, row.salt);
  const isMatch = timingSafeEqual(computedHash, row.code_hash);

  if (!isMatch) {
    try {
      const nextAttempts = await incrementOtpAttempt(row);
      await incrementRateLimit("verify_otp", "email", email, VERIFY_LIMITS.email);
      await incrementRateLimit("verify_otp", "ip", ip, VERIFY_LIMITS.ip);

      const attemptsRemaining = Math.max(0, (row.max_attempts ?? 5) - nextAttempts);
      if (attemptsRemaining === 0) {
        return errorResponse(
          "Incorrect code. You have reached the maximum attempts. Request a new code.",
          401
        );
      }
      return errorResponse(
        `Incorrect code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`,
        401
      );
    } catch (error) {
      console.error("auth-verify-otp update error:", error);
      return errorResponse("Unable to verify the code right now. Please try again.", 500);
    }
  }

  await deleteOtpRows(email);
  await clearRateLimit("verify_otp", "email", email);
  await clearRateLimit("verify_otp", "ip", ip);

  const supabase = createAdminClient();
  const { data: userRow, error: userError } = await supabase
    .from("app_users")
    .select("id, email, name")
    .eq("email", email)
    .order("created_at", { ascending: true })
    .limit(1);

  let userId: string;
  let name: string | null = null;

  if (userError) {
    console.error("auth-verify-otp app_users select error:", userError);
    return errorResponse("Unable to finish sign-in right now. Please try again.", 500);
  }

  const existingUser = (userRow ?? [])[0] as
    | { id: string; email: string; name: string | null }
    | undefined;

  if (existingUser) {
    userId = existingUser.id;
    name = existingUser.name ?? null;
  } else {
    userId = crypto.randomUUID();
    try {
      await upsertAppUser({
        userId,
        email,
        name: null,
      });
    } catch (error) {
      console.error("auth-verify-otp app_users insert error:", error);
      return errorResponse("Unable to finish sign-in right now. Please try again.", 500);
    }
  }

  let token: string;
  try {
    token = await createJwt(
      {
        sub: userId,
        email,
      },
      2 * 60 * 60
    );
  } catch (err) {
    console.error("auth-verify-otp jwt error:", err);
    return errorResponse("Unable to finish sign-in right now. Please try again.", 500);
  }

  const response = jsonResponse({
    id: userId,
    email,
    name,
    token,
  });

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", createSessionCookie(token));

  return new Response(response.body, { status: response.status, headers });
});
