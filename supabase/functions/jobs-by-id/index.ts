import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { getJob, updateJob, deleteJob } from "../_shared/db.ts";
import { validateUUID, sanitizePatchBody, sanitizePatchValues } from "../_shared/validation.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return errorResponse("Invalid or missing job ID", 400);

  if (req.method === "GET") {
    try {
      const job = await getJob(id, identity.userId);
      if (!job) return errorResponse("Job not found", 404);
      return jsonResponse(job);
    } catch (err) {
      console.error("GET /jobs-by-id error:", err);
      return errorResponse("Failed to get job", 500);
    }
  }

  if (req.method === "PATCH") {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    const sanitized = sanitizePatchValues(sanitizePatchBody(body));

    try {
      const updated = await updateJob(id, identity.userId, sanitized);
      if (!updated) return errorResponse("Job not found", 404);
      return jsonResponse(updated);
    } catch (err) {
      console.error("PATCH /jobs-by-id error:", err);
      return errorResponse("Failed to update job", 500);
    }
  }

  if (req.method === "DELETE") {
    try {
      const deleted = await deleteJob(id, identity.userId);
      if (!deleted) return errorResponse("Job not found", 404);
      return jsonResponse({ success: true });
    } catch (err) {
      console.error("DELETE /jobs-by-id error:", err);
      return errorResponse("Failed to delete job", 500);
    }
  }

  return errorResponse("Method not allowed", 405);
});
