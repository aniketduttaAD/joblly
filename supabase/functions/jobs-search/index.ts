import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { searchJobsByTitleCompany } from "../_shared/db.ts";
import type { JobStatus } from "../_shared/types.ts";

const VALID_STATUSES = new Set([
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]);

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const statusParam = url.searchParams.get("status") ?? "";
  const status = VALID_STATUSES.has(statusParam) ? (statusParam as JobStatus) : undefined;

  if (!q && !status) return jsonResponse({ jobs: [], total: 0 });

  try {
    const result = await searchJobsByTitleCompany(identity.userId, q, status);
    return jsonResponse(result);
  } catch (err) {
    console.error("GET /jobs-search error:", err);
    return errorResponse("Search failed", 500);
  }
});
