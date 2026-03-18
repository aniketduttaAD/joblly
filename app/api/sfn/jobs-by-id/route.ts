import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { deleteJobWithCheck, getJob, updateJob } from "@/lib/server/jobs";
import { sanitizePatchBody, sanitizePatchValues, validateUUID } from "@/lib/server/validation";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return json(req, { error: "Invalid or missing job ID" }, { status: 400 });

  try {
    const job = await getJob(id, identity.userId);
    if (!job) return json(req, { error: "Job not found" }, { status: 404 });
    return json(req, job);
  } catch (err) {
    console.error("GET /jobs-by-id error:", err);
    return json(req, { error: "Failed to get job" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return json(req, { error: "Invalid or missing job ID" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  const sanitized = sanitizePatchValues(sanitizePatchBody(body));
  try {
    const updated = await updateJob(id, identity.userId, sanitized as any);
    if (!updated) return json(req, { error: "Job not found" }, { status: 404 });
    return json(req, updated);
  } catch (err) {
    console.error("PATCH /jobs-by-id error:", err);
    return json(req, { error: "Failed to update job" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return json(req, { error: "Invalid or missing job ID" }, { status: 400 });

  try {
    const deleted = await deleteJobWithCheck(id, identity.userId);
    if (!deleted) return json(req, { error: "Job not found" }, { status: 404 });
    return json(req, { success: true });
  } catch (err) {
    console.error("DELETE /jobs-by-id error:", err);
    return json(req, { error: "Failed to delete job" }, { status: 500 });
  }
}
