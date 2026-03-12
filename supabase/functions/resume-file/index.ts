import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest, createAdminClient } from "../_shared/auth.ts";
import { getResumeFileInfo } from "../_shared/db.ts";
import { validateUUID } from "../_shared/validation.ts";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return errorResponse("Invalid or missing resume ID", 400);

  try {
    const fileInfo = await getResumeFileInfo(id, identity.userId);
    if (!fileInfo) return errorResponse("Resume not found", 404);

    const supabase = createAdminClient();
    const { data, error } = await supabase.storage.from("resumes").download(fileInfo.storagePath);

    if (error || !data) return errorResponse("File not found in storage", 404);

    const arrayBuffer = await data.arrayBuffer();

    return new Response(arrayBuffer, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileInfo.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err) {
    console.error("GET /resume-file error:", err);
    return errorResponse("Failed to retrieve file", 500);
  }
});
