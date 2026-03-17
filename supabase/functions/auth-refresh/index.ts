import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  clearSessionCookies,
  createAccessCookie,
  createAdminClient,
  createAppJwt,
  getRefreshTokenFromRequest,
  verifyAppJwt,
} from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    const response = jsonResponse({ error: "Unauthorized" }, 401);
    const headers = new Headers(response.headers);
    for (const cookie of clearSessionCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  const claims = await verifyAppJwt(refreshToken, "refresh");
  if (!claims) {
    const response = jsonResponse({ error: "Unauthorized" }, 401);
    const headers = new Headers(response.headers);
    for (const cookie of clearSessionCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  const { userId, email } = claims;

  let accessToken: string;
  try {
    accessToken = await createAppJwt(
      {
        sub: userId,
        email,
      },
      5 * 60,
      "access"
    );
  } catch (error) {
    console.error("auth-refresh jwt error:", error);
    const response = jsonResponse({ error: "Unable to refresh session" }, 500);
    const headers = new Headers(response.headers);
    for (const cookie of clearSessionCookies()) {
      headers.append("Set-Cookie", cookie);
    }
    return new Response(response.body, { status: response.status, headers });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("app_users")
    .select("id, email, name")
    .eq("id", userId)
    .maybeSingle();

  const identity = {
    id: userId,
    email: (data?.email as string | undefined) ?? email,
    name: (data?.name as string | null | undefined) ?? null,
  };

  if (error) {
    console.error("auth-refresh app_users select error:", error);
  }

  const response = jsonResponse(identity);
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", createAccessCookie(accessToken));

  return new Response(response.body, { status: response.status, headers });
});
