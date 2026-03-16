import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

function createExpiredSessionCookie(): string {
  const isProd = Deno.env.get("NODE_ENV") === "production";
  const parts = ["jobtracker_session=", "Path=/", "Max-Age=0", "HttpOnly"];
  if (isProd) {
    parts.push("SameSite=None", "Secure", "Partitioned");
  } else {
    parts.push("SameSite=Lax");
  }
  return parts.join("; ");
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const response = jsonResponse({ success: true });

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", createExpiredSessionCookie());

  return new Response(response.body, { status: response.status, headers });
});
