import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { clearSessionCookies } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const response = jsonResponse({ success: true });

  const headers = new Headers(response.headers);
  for (const cookie of clearSessionCookies()) {
    headers.append("Set-Cookie", cookie);
  }

  return new Response(response.body, { status: response.status, headers });
});
