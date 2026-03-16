import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";

const OTP_LENGTH = 4;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

async function hashCode(code: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${code}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getJwtSecret(): string {
  const secret = Deno.env.get("API_KEY") ?? "";
  if (!secret) {
    throw new Error("API_KEY is not configured");
  }
  return secret;
}

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
    encoder.encode(getJwtSecret()),
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

  let body: { email?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const email = normalizeEmail(body.email ?? "");
  const code = (body.code ?? "").trim();

  if (!email || !code || code.length !== OTP_LENGTH) {
    return errorResponse("Invalid or expired code.", 400);
  }

  const supabase = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: row, error: selectError } = await supabase
    .from("email_otps")
    .select("*")
    .eq("email", email)
    .maybeSingle();

  if (selectError) {
    console.error("auth-verify-otp select error:", selectError);
    return errorResponse("Invalid or expired code.", 401);
  }

  if (!row) {
    return errorResponse("Invalid or expired code.", 401);
  }

  const expiresAt = new Date(row.expires_at as string);
  const now = new Date(nowIso);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    await supabase
      .from("email_otps")
      .delete()
      .eq("email", email)
      .catch(() => {});
    return errorResponse("Invalid or expired code.", 401);
  }

  const attempts = (row.attempts as number) ?? 0;
  const maxAttempts = (row.max_attempts as number) ?? 5;

  const computedHash = await hashCode(code, row.salt as string);
  const isMatch = computedHash === (row.code_hash as string);

  if (!isMatch) {
    const nextAttempts = attempts + 1;
    const update: Record<string, unknown> = { attempts: nextAttempts };
    if (nextAttempts >= maxAttempts) {
      update.blocked_until = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    }
    await supabase
      .from("email_otps")
      .update(update)
      .eq("email", email)
      .catch(() => {});
    return errorResponse("Invalid or expired code.", 401);
  }

  await supabase
    .from("email_otps")
    .delete()
    .eq("email", email)
    .catch(() => {});

  const { data: userRow, error: userError } = await supabase
    .from("app_users")
    .select("id, email, name")
    .eq("email", email)
    .limit(1)
    .maybeSingle();

  let userId: string;
  let name: string | null = null;

  if (userError) {
    console.error("auth-verify-otp app_users select error:", userError);
    return errorResponse("Invalid or expired code.", 401);
  }

  if (userRow) {
    userId = userRow.id as string;
    name = (userRow.name as string | null) ?? null;
  } else {
    userId = crypto.randomUUID();
    const nowStr = new Date().toISOString();
    const { error: insertError } = await supabase.from("app_users").insert({
      id: userId,
      email,
      name: null,
      created_at: nowStr,
      updated_at: nowStr,
    });
    if (insertError) {
      console.error("auth-verify-otp app_users insert error:", insertError);
      return errorResponse("Invalid or expired code.", 401);
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
    return errorResponse("Invalid or expired code.", 401);
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
