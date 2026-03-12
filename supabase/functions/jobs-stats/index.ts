import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { readJobsStats } from "../_shared/db.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  try {
    const stats = await readJobsStats(identity.userId);
    return jsonResponse(stats);
  } catch (err) {
    console.error("GET /jobs-stats error:", err);
    return errorResponse("Failed to get stats", 500);
  }
});
