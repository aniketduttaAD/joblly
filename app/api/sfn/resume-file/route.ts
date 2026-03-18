import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json, withCors } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { getPrivateBlobStream } from "@/lib/server/blob";
import { getResumeFileInfo } from "@/lib/server/resumes";
import { validateUUID } from "@/lib/server/validation";

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
    const fileInfo = await getResumeFileInfo(id, identity.userId);
    if (!fileInfo) return json(req, { error: "Resume not found" }, { status: 404 });

    const blobResult = await getPrivateBlobStream(fileInfo.blobPathname);
    if (!blobResult || blobResult.statusCode !== 200) {
      return json(req, { error: "File not found in storage" }, { status: 404 });
    }

    const res = new NextResponse(blobResult.stream, {
      headers: {
        "Content-Type": blobResult.blob.contentType || "application/pdf",
        "Content-Disposition": `inline; filename="${encodeURIComponent(fileInfo.fileName)}"`,
        "Cache-Control": "private, max-age=3600",
        ETag: blobResult.blob.etag,
      },
    });
    return withCors(req, res);
  } catch (err) {
    console.error("GET /resume-file error:", err);
    return json(req, { error: "Failed to retrieve file" }, { status: 500 });
  }
}
