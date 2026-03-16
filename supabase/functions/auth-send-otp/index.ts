import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";

const OTP_LENGTH = 4;
const OTP_EXPIRY_MINUTES = 10;
const MAX_SENDS_PER_WINDOW = 5;
const SEND_WINDOW_MINUTES = 60;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateOtp(): string {
  const max = 10 ** OTP_LENGTH;
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % max;
  return n.toString().padStart(OTP_LENGTH, "0");
}

async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function sendOtpEmail(email: string, code: string) {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");

  if (!apiKey || !from) {
    console.warn("RESEND_API_KEY or RESEND_FROM_EMAIL not configured; skipping email send");
    return;
  }

  const payload = {
    from,
    to: [email],
    subject: "Your sign-in code",
    html: `<p>Your verification code is <strong>${code}</strong>. It will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>`,
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error("Resend email error:", await res.text().catch(() => res.statusText));
  }
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { email?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const rawEmail = body.email ?? "";
  const email = normalizeEmail(rawEmail);
  if (!email) return errorResponse("Email is required", 400);

  const supabase = createAdminClient();

  const now = new Date();
  const windowStart = new Date(now.getTime() - SEND_WINDOW_MINUTES * 60 * 1000).toISOString();

  // basic per-email rate limiting using email_otps
  const { data: existingRows, error: selectError } = await supabase
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .gte("window_start", windowStart)
    .limit(1);

  if (selectError) {
    console.error("auth-send-otp select error:", selectError);
    return errorResponse("Failed to send code", 500);
  }

  const existing = existingRows?.[0] as
    | {
        id: string;
        send_count: number;
        blocked_until: string | null;
      }
    | undefined;

  if (existing?.blocked_until && new Date(existing.blocked_until) > now) {
    return errorResponse("Invalid or expired code.", 429);
  }

  if (existing && existing.send_count >= MAX_SENDS_PER_WINDOW) {
    return errorResponse("Invalid or expired code.", 429);
  }

  const code = generateOtp();
  const salt = crypto.randomUUID();
  const codeHash = await hashCode(code, salt);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();

  const upsertPayload: Record<string, unknown> = {
    email,
    code_hash: codeHash,
    salt,
    attempts: 0,
    max_attempts: 5,
    expires_at: expiresAt,
    window_start: now.toISOString(),
  };

  if (existing) {
    upsertPayload.send_count = existing.send_count + 1;
  } else {
    upsertPayload.send_count = 1;
  }

  const { error: upsertError } = await supabase.from("email_otps").upsert(upsertPayload, {
    onConflict: "email",
  });

  if (upsertError) {
    console.error("auth-send-otp upsert error:", upsertError);
    return errorResponse("Failed to send code", 500);
  }

  // ensure app_users row exists for this email
  const { data: userRow, error: userSelectError } = await supabase
    .from("app_users")
    .select("id")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  let userId: string;
  if (userSelectError) {
    console.error("auth-send-otp app_users select error:", userSelectError);
    return errorResponse("Failed to send code", 500);
  }

  if (userRow) {
    userId = userRow.id as string;
  } else {
    userId = crypto.randomUUID();
    const { error: insertUserError } = await supabase.from("app_users").insert({
      id: userId,
      email,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
    if (insertUserError) {
      console.error("auth-send-otp app_users insert error:", insertUserError);
      return errorResponse("Failed to send code", 500);
    }
  }

  await sendOtpEmail(email, code).catch((err) => {
    console.error("auth-send-otp send email error:", err);
  });

  return jsonResponse({ userId });
});
