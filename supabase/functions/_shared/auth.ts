import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export interface AuthenticatedUserIdentity {
  userId: string;
  email: string;
  name?: string | null;
}

function getSupabaseUrl(): string {
  return Deno.env.get("SUPABASE_URL") ?? "";
}

function getServiceRoleKey(): string {
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
}

function getAnonKey(): string {
  return Deno.env.get("SUPABASE_ANON_KEY") ?? "";
}

export function createAdminClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

export function getAppJwtSecret(): string {
  const secret = Deno.env.get("APP_JWT_SECRET") ?? Deno.env.get("API_KEY") ?? "";
  if (!secret) {
    throw new Error("APP_JWT_SECRET or API_KEY is not configured");
  }
  return secret;
}

function parseCookies(req: Request): Record<string, string> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  if (!cookieHeader) return {};
  return Object.fromEntries(
    cookieHeader.split(";").map((c) => {
      const [k, ...v] = c.trim().split("=");
      return [k.trim(), decodeURIComponent(v.join("="))];
    })
  );
}

export function getAppJwtFromRequest(req: Request): string | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookies = parseCookies(req);
  const cookieToken = cookies["jobtracker_session"];
  return cookieToken ?? null;
}

export async function verifyAppJwt(
  token: string
): Promise<{ userId: string; email: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [headerB64, payloadB64, signatureB64] = parts;
    const encoder = new TextEncoder();

    const base64UrlToBytes = (input: string): Uint8Array => {
      const pad = 4 - (input.length % 4 || 4);
      const base64 = input.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat(pad);
      const raw = atob(base64);
      const bytes = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        bytes[i] = raw.charCodeAt(i);
      }
      return bytes;
    };

    const data = encoder.encode(`${headerB64}.${payloadB64}`);
    const signature = base64UrlToBytes(signatureB64);

    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(getAppJwtSecret()),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );

    const valid = await crypto.subtle.verify("HMAC", key, signature, data);
    if (!valid) return null;

    const payloadJson = new TextDecoder().decode(base64UrlToBytes(payloadB64));
    const payload = JSON.parse(payloadJson) as {
      sub?: string;
      email?: string;
      exp?: number;
    };
    if (!payload.sub || !payload.email) return null;
    if (typeof payload.exp === "number") {
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp <= now) return null;
    }
    return { userId: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}

export async function getUserFromRequest(req: Request): Promise<AuthenticatedUserIdentity | null> {
  const token = getAppJwtFromRequest(req);
  if (!token) return null;

  let claims: { userId: string; email: string } | null = null;
  try {
    claims = await verifyAppJwt(token);
  } catch (error) {
    console.error("getUserFromRequest verifyAppJwt error:", error);
    return null;
  }
  if (!claims) return null;

  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase
      .from("app_users")
      .select("id, email, name")
      .eq("id", claims.userId)
      .maybeSingle();
    if (error || !data) {
      return {
        userId: claims.userId,
        email: claims.email,
        name: null,
      };
    }
    return {
      userId: data.id as string,
      email: (data.email as string) ?? claims.email,
      name: (data.name as string | null) ?? null,
    };
  } catch {
    return {
      userId: claims.userId,
      email: claims.email,
      name: null,
    };
  }
}

export function isApiAuthorized(req: Request): boolean {
  const apiKey = Deno.env.get("API_KEY");
  if (apiKey) {
    const keyHeader = req.headers.get("x-api-key");
    if (keyHeader && keyHeader === apiKey) return true;
  }
  const siteUrl = Deno.env.get("SITE_URL");
  if (siteUrl) {
    const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    if (origin.startsWith(siteUrl)) return true;
  }
  return false;
}
