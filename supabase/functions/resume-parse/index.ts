import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { parseResumeTextEnhanced } from "../_shared/resume-parser.ts";

const PDF_SIZE_LIMIT = 5 * 1024 * 1024;
const MAX_TEXT_LENGTH = 65_000;

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return errorResponse("Expected multipart/form-data with a 'file' field", 400);
  }

  const fileEntry = formData.get("file");
  if (!(fileEntry instanceof File)) {
    return errorResponse("Missing 'file' field", 400);
  }

  const file = fileEntry as File;
  const fileName = file.name.toLowerCase();
  const isPdf = file.type === "application/pdf" || fileName.endsWith(".pdf");
  if (!isPdf) return errorResponse("Only PDF files are supported", 400);
  if (file.size > PDF_SIZE_LIMIT) return errorResponse("File must be 5MB or smaller", 400);

  try {
    const { default: pdfParse } = await import("npm:pdf-parse");
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfData = await pdfParse(buffer);
    const text = pdfData.text?.slice(0, MAX_TEXT_LENGTH) ?? "";

    const parsedContent = parseResumeTextEnhanced(text);

    return jsonResponse({ content: text, parsedContent });
  } catch (err) {
    console.error("POST /resume-parse error:", err);
    return errorResponse("Failed to parse PDF", 422);
  }
});
