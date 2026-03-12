import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest, createAdminClient } from "../_shared/auth.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  try {
    const supabase = createAdminClient();
    await supabase.auth.admin.signOut(identity.userId);
  } catch {}

  const response = jsonResponse({ success: true });

  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", `sb-access-token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  headers.append("Set-Cookie", `sb-refresh-token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
  headers.append("Set-Cookie", `jobtracker_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);

  return new Response(response.body, { status: response.status, headers });
});
