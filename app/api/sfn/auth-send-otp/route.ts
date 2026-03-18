import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import {
  OTP_EXPIRY_MINUTES,
  assertPublicAuthRequest,
  checkRateLimit,
  deleteOtpRows,
  generateOtp,
  getClientIp,
  hashCode,
  incrementRateLimit,
  isValidEmail,
  normalizeEmail,
  saveOtpRow,
} from "@/lib/server/otp";

const MAX_VERIFY_ATTEMPTS = 5;

const SEND_LIMITS = {
  email: { maxAttempts: 5, windowMinutes: 60, blockMinutes: 60 },
  ip: { maxAttempts: 10, windowMinutes: 60, blockMinutes: 60 },
} as const;

async function sendOtpEmail(email: string, code: string, timeoutMs = 10000) {
  const apiKey = (process.env.RESEND_API_KEY ?? "").trim();
  const rawFrom = (process.env.RESEND_FROM_EMAIL ?? "").trim();

  if (!apiKey || !rawFrom) {
    throw new Error("OTP delivery is not configured (missing RESEND_API_KEY or RESEND_FROM_EMAIL).");
  }
  const from = rawFrom.includes("<") ? rawFrom : `Joblly <${rawFrom}>`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort("otp-email-timeout"), timeoutMs);

  const payload = {
    from,
    to: [email],
    subject: "Your sign-in code",
    html: `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Your sign-in code</title>
      </head>
      <body
        style="
          font-family: system-ui, -apple-system, sans-serif;
          line-height: 1.5;
          color: #1a1a1a;
          max-width: 480px;
          margin: 0 auto;
          padding: 24px;
        "
      >
        <h2 style="margin: 0 0 16px; font-size: 1.25rem">
          Your sign-in code
        </h2>
  
        <p style="margin: 0 0 16px">
          Use this code to sign in. It was sent to 
          <strong>${email}</strong>.
        </p>
  
        <p style="
          margin: 0 0 24px;
          font-size: 1.5rem;
          font-weight: 700;
          letter-spacing: 0.25em;
        ">
          ${code}
        </p>
  
        <p style="margin: 0; font-size: 0.875rem; color: #666">
          This code expires in ${OTP_EXPIRY_MINUTES} minutes. 
          If you didn't request it, you can ignore this email.
        </p>
      </body>
    </html>
    `,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!res.ok) {
      const details = await res.text().catch(() => res.statusText);
      throw new Error(details || "Failed to deliver OTP email.");
    }
  } finally {
    clearTimeout(timer);
  }
}

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

  let body: { email?: string };
  try {
    body = (await req.json()) as { email?: string };
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  const email = normalizeEmail(body.email ?? "");
  if (!email) return json(req, { error: "Email is required." }, { status: 400 });
  if (!isValidEmail(email))
    return json(req, { error: "Enter a valid email address." }, { status: 400 });

  const ip = getClientIp(req);

  const emailLimit = await checkRateLimit("send_otp", "email", email, SEND_LIMITS.email);
  if (emailLimit.limited) {
    return json(
      req,
      { error: "Too many codes sent to this email. Please wait before requesting another one." },
      { status: 429, headers: { "Retry-After": String(emailLimit.retryAfterSeconds) } }
    );
  }

  const ipLimit = await checkRateLimit("send_otp", "ip", ip, SEND_LIMITS.ip);
  if (ipLimit.limited) {
    return json(
      req,
      { error: "Too many OTP requests from this network. Please try again later." },
      { status: 429, headers: { "Retry-After": String(ipLimit.retryAfterSeconds) } }
    );
  }

  const code = generateOtp();
  const salt = crypto.randomUUID();
  const codeHash = await hashCode(code, salt);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();

  try {
    await saveOtpRow(email, {
      codeHash,
      salt,
      expiresAt,
      maxAttempts: MAX_VERIFY_ATTEMPTS,
    });
  } catch (error) {
    console.error("auth-send-otp save error:", error);
    return json(
      req,
      { error: "Unable to send a verification code right now. Please try again." },
      { status: 500 }
    );
  }

  await incrementRateLimit("send_otp", "email", email, SEND_LIMITS.email);
  await incrementRateLimit("send_otp", "ip", ip, SEND_LIMITS.ip);

  // Must await — Vercel terminates the function on response return,
  // so fire-and-forget promises never complete in serverless.
  try {
    await sendOtpEmail(email, code);
  } catch (error) {
    console.error("auth-send-otp delivery error:", error);
    // Roll back the saved row so the user can retry cleanly
    await deleteOtpRows(email).catch(() => {});
    return json(
      req,
      { error: "Failed to send the verification email. Please try again." },
      { status: 500 }
    );
  }

  return json(req, {
    userId: email,
    expiresInMinutes: OTP_EXPIRY_MINUTES,
  });
}
