import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { getResume, updateResumeMetadata, deleteResume } from "../_shared/db.ts";
import { validateUUID } from "../_shared/validation.ts";
import type { ParsedResume } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return errorResponse("Invalid or missing resume ID", 400);

  if (req.method === "GET") {
    try {
      const resume = await getResume(id, identity.userId);
      if (!resume) return errorResponse("Resume not found", 404);
      return jsonResponse(resume);
    } catch (err) {
      console.error("GET /resume-by-id error:", err);
      return errorResponse("Failed to get resume", 500);
    }
  }

  if (req.method === "PATCH") {
    let body: { content?: string; parsedContent?: ParsedResume; isVerified?: boolean };
    try {
      body = await req.json();
    } catch {
      return errorResponse("Invalid JSON body", 400);
    }

    try {
      const updated = await updateResumeMetadata(id, identity.userId, {
        content: body.content,
        parsedContent: body.parsedContent,
        isVerified: body.isVerified,
      });
      if (!updated) return errorResponse("Resume not found", 404);
      return jsonResponse(updated);
    } catch (err) {
      console.error("PATCH /resume-by-id error:", err);
      return errorResponse("Failed to update resume", 500);
    }
  }

  if (req.method === "DELETE") {
    try {
      const deleted = await deleteResume(id, identity.userId);
      if (!deleted) return errorResponse("Resume not found", 404);
      return jsonResponse({ success: true });
    } catch (err) {
      console.error("DELETE /resume-by-id error:", err);
      return errorResponse("Failed to delete resume", 500);
    }
  }

  return errorResponse("Method not allowed", 405);
});
