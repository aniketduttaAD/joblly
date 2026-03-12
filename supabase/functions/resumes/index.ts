import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest, createAdminClient } from "../_shared/auth.ts";
import { listResumes, createResume } from "../_shared/db.ts";
import type { ParsedResume } from "../_shared/types.ts";

const PDF_SIZE_LIMIT = 5 * 1024 * 1024; // 5MB
const MAX_TEXT_LENGTH = 65_000;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  // GET — list resumes
  if (req.method === "GET") {
    try {
      const resumes = await listResumes(identity.userId);
      return jsonResponse(resumes);
    } catch (err) {
      console.error("GET /resumes error:", err);
      return errorResponse("Failed to list resumes", 500);
    }
  }

  // POST — upload new resume
  if (req.method === "POST") {
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return errorResponse("Expected multipart/form-data", 400);
    }

    const fileEntry = formData.get("file");
    const name = (formData.get("name") as string | null)?.trim() ?? "";
    const contentStr = (formData.get("content") as string | null) ?? "";
    const parsedContentStr = (formData.get("parsedContent") as string | null) ?? "";

    if (!(fileEntry instanceof File)) {
      return errorResponse("Missing file field", 400);
    }

    const file = fileEntry as File;
    const fileName = file.name.toLowerCase();
    const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
    if (!isPdf) return errorResponse("Only PDF files are supported", 400);
    if (file.size > PDF_SIZE_LIMIT) return errorResponse("File must be 5MB or smaller", 400);

    let content = contentStr;
    let parsedContent: ParsedResume;

    // Parse PDF if content not provided
    if (!content) {
      try {
        const { default: pdfParse } = await import("npm:pdf-parse");
        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const pdfData = await pdfParse(buffer);
        content = pdfData.text?.slice(0, MAX_TEXT_LENGTH) ?? "";
      } catch (err) {
        console.error("PDF parse error:", err);
        return errorResponse("Failed to extract text from PDF", 422);
      }
    } else {
      content = content.slice(0, MAX_TEXT_LENGTH);
    }

    if (parsedContentStr) {
      try {
        parsedContent = JSON.parse(parsedContentStr) as ParsedResume;
      } catch {
        parsedContent = {
          skills: [],
          experience: [],
          projects: [],
          education: [],
          rawText: content,
        };
      }
    } else {
      parsedContent = { skills: [], experience: [], projects: [], education: [], rawText: content };
    }

    const id = crypto.randomUUID();

    // Upload PDF to Supabase Storage
    try {
      const supabase = createAdminClient();
      const arrayBuffer = await file.arrayBuffer();
      const { error: storageError } = await supabase.storage
        .from("resumes")
        .upload(`${identity.userId}/${id}`, arrayBuffer, {
          contentType: "application/pdf",
          upsert: false,
        });
      if (storageError) throw storageError;
    } catch (err) {
      console.error("Storage upload error:", err);
      return errorResponse("Failed to upload file", 500);
    }

    try {
      const resume = await createResume(
        id,
        identity,
        { name: file.name, size: file.size, type: file.type || "application/pdf" },
        name || file.name,
        { content, parsedContent }
      );
      return jsonResponse(resume, 201);
    } catch (err) {
      // Cleanup storage on DB failure
      const supabase = createAdminClient();
      await supabase.storage
        .from("resumes")
        .remove([`${identity.userId}/${id}`])
        .catch(() => {});
      console.error("POST /resumes error:", err);
      return errorResponse("Failed to create resume", 500);
    }
  }

  return errorResponse("Method not allowed", 405);
});
