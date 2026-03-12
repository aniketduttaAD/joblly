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

/** Creates an admin client (service role — bypasses RLS). */
export function createAdminClient() {
  return createClient(getSupabaseUrl(), getServiceRoleKey(), {
    auth: { persistSession: false },
  });
}

/** Creates a user-scoped client using the JWT from the request. */
export function createUserClient(jwt: string) {
  return createClient(getSupabaseUrl(), getAnonKey(), {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
}

/**
 * Validates the request and returns the authenticated user identity.
 * Checks:
 *   1. Authorization: Bearer <token>
 *   2. jobtracker_session / sb-access-token cookie
 * Returns null if not authenticated.
 */
export async function getUserFromRequest(req: Request): Promise<AuthenticatedUserIdentity | null> {
  // Try Authorization Bearer header
  const authHeader = req.headers.get("authorization");
  let token: string | null = null;

  if (authHeader?.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  // Try cookie fallback
  if (!token) {
    const cookieHeader = req.headers.get("cookie") ?? "";
    const cookies = Object.fromEntries(
      cookieHeader.split(";").map((c) => {
        const [k, ...v] = c.trim().split("=");
        return [k.trim(), decodeURIComponent(v.join("="))];
      })
    );
    token = cookies["sb-access-token"] ?? cookies["jobtracker_session"] ?? null;
  }

  if (!token) return null;

  try {
    const supabase = createUserClient(token);
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) return null;

    return {
      userId: data.user.id,
      email: data.user.email ?? "",
      name:
        (data.user.user_metadata?.full_name as string | undefined) ??
        (data.user.user_metadata?.name as string | undefined) ??
        null,
    };
  } catch {
    return null;
  }
}

/**
 * Same-origin / API key check for internal routes.
 * Passes if request has correct X-API-Key header or
 * the origin matches SITE_URL env var.
 */
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
