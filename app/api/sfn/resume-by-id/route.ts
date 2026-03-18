import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { deleteBlob } from "@/lib/server/blob";
import { deleteResumeRow, getResume, updateResumeMetadata } from "@/lib/server/resumes";
import { validateUUID } from "@/lib/server/validation";
import type { ParsedResume } from "@/app/job/search/types";

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
  if (!id) return json(req, { error: "Invalid or missing resume ID" }, { status: 400 });

  try {
    const resume = await getResume(id, identity.userId);
    if (!resume) return json(req, { error: "Resume not found" }, { status: 404 });
    return json(req, resume);
  } catch (err) {
    console.error("GET /resume-by-id error:", err);
    return json(req, { error: "Failed to get resume" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return json(req, { error: "Invalid or missing resume ID" }, { status: 400 });

  let body: { content?: string; parsedContent?: ParsedResume; isVerified?: boolean };
  try {
    body = (await req.json()) as {
      content?: string;
      parsedContent?: ParsedResume;
      isVerified?: boolean;
    };
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    const updated = await updateResumeMetadata(id, identity.userId, {
      content: body.content,
      parsedContent: body.parsedContent,
      isVerified: body.isVerified,
    });
    if (!updated) return json(req, { error: "Resume not found" }, { status: 404 });
    return json(req, updated);
  } catch (err) {
    console.error("PATCH /resume-by-id error:", err);
    return json(req, { error: "Failed to update resume" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const id = validateUUID(url.searchParams.get("id"));
  if (!id) return json(req, { error: "Invalid or missing resume ID" }, { status: 400 });

  try {
    const { deleted, blobPathname } = await deleteResumeRow(id, identity.userId);
    if (!deleted) return json(req, { error: "Resume not found" }, { status: 404 });
    if (blobPathname) {
      await deleteBlob(blobPathname).catch(() => {});
    }
    return json(req, { success: true });
  } catch (err) {
    console.error("DELETE /resume-by-id error:", err);
    return json(req, { error: "Failed to delete resume" }, { status: 500 });
  }
}
