import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { deleteBlob, putPrivatePdf, resumePdfPathname } from "@/lib/server/blob";
import { createResume, listResumes } from "@/lib/server/resumes";
import type { ParsedResume } from "@/app/job/search/types";

const MAX_TEXT_LENGTH = 65000;

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  try {
    const resumes = await listResumes(identity.userId);
    return json(req, { resumes });
  } catch (err) {
    console.error("GET /resumes error:", err);
    return json(req, { error: "Failed to list resumes" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return json(req, { error: "Expected multipart/form-data" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  const name = (formData.get("name") as string | null)?.trim() ?? "";
  const contentStr = (formData.get("content") as string | null) ?? "";
  const parsedContentStr = (formData.get("parsedContent") as string | null) ?? "";

  if (!(fileEntry instanceof File)) {
    return json(req, { error: "Missing file field" }, { status: 400 });
  }

  const file = fileEntry as File;
  const id = crypto.randomUUID();
  const blobPathname = resumePdfPathname(identity.userId, id);

  const content = (contentStr || "").slice(0, MAX_TEXT_LENGTH);
  let parsedContent: ParsedResume;
  try {
    parsedContent = parsedContentStr
      ? (JSON.parse(parsedContentStr) as ParsedResume)
      : ({} as ParsedResume);
  } catch {
    parsedContent = {} as ParsedResume;
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    await putPrivatePdf(blobPathname, arrayBuffer, file.name);
  } catch (err) {
    console.error("Blob upload error:", err);
    return json(req, { error: "Failed to upload file" }, { status: 500 });
  }

  try {
    const resume = await createResume(
      id,
      identity,
      { name: file.name, size: file.size, type: file.type || "application/pdf" },
      name || file.name,
      { content, parsedContent, blobPathname }
    );
    return json(req, resume, { status: 201 });
  } catch (err) {
    await deleteBlob(blobPathname).catch(() => {});
    console.error("POST /resumes error:", err);
    return json(req, { error: "Failed to create resume" }, { status: 500 });
  }
}
