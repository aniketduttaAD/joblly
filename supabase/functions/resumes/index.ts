import "jsr:@supabase/functions-js/edge-runtime.d.ts";

import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest, createAdminClient } from "../_shared/auth.ts";
import { listResumes, createResume } from "../_shared/db.ts";
import type { ParsedResume } from "../_shared/types.ts";

import OpenAI from "npm:openai@6.27.0";

const MAX_TEXT_LENGTH = 65000;

async function parseResumeWithOpenAI(content: string): Promise<ParsedResume> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  const client = new OpenAI({ apiKey });

  const model = "gpt-4.1-mini";

  const response: any = await client.responses.create({
    model,
    response_format: { type: "json_object" },
    input: `
Extract structured resume data from the following resume text.

Return ONLY JSON in this format:

{
  "skills": string[],
  "experience": [
    {
      "company": string,
      "role": string,
      "startDate": string,
      "endDate": string | null,
      "description": string
    }
  ],
  "projects": [
    {
      "name": string,
      "description": string,
      "technologies": string[]
    }
  ],
  "education": [
    {
      "institution": string,
      "degree": string,
      "field": string,
      "graduationDate": string
    }
  ],
  "certifications": [
    {
      "name": string,
      "issuer": string,
      "date": string
    }
  ],
  "rawText": string
}

Resume text:
${content}
`,
  });

  const raw = response.output_text?.[0] ?? "{}";

  const parsed = JSON.parse(raw) as ParsedResume;

  return {
    skills: parsed.skills ?? [],
    experience: parsed.experience ?? [],
    projects: parsed.projects ?? [],
    education: parsed.education ?? [],
    certifications: parsed.certifications ?? [],
    rawText: parsed.rawText ?? "",
  };
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const isPreview = url.searchParams.get("preview") === "true";

  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  if (req.method === "GET") {
    try {
      const resumes = await listResumes(identity.userId);
      return jsonResponse(resumes);
    } catch (err) {
      console.error("GET /resumes error:", err);
      return errorResponse("Failed to list resumes", 500);
    }
  }

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

    const trimmedContentStr = (contentStr || "").slice(0, MAX_TEXT_LENGTH);
    const content = trimmedContentStr;
    let parsedContent: ParsedResume;

    if (isPreview) {
      try {
        parsedContent = await parseResumeWithOpenAI(content);
        return jsonResponse({ content, parsedContent });
      } catch (err) {
        console.error("OpenAI preview parse error:", err);
        return errorResponse("Failed to parse resume", 500);
      }
    }

    if (parsedContentStr) {
      try {
        parsedContent = JSON.parse(parsedContentStr) as ParsedResume;
      } catch {
        parsedContent = await parseResumeWithOpenAI(content);
      }
    } else {
      parsedContent = await parseResumeWithOpenAI(content);
    }

    const id = crypto.randomUUID();

    try {

      const supabase = createAdminClient();

      const arrayBuffer = await file.arrayBuffer();

      const { error: storageError } = await supabase.storage
        .from("resumes")
        .upload(`${identity.userId}/${id}`, arrayBuffer, {
          contentType: "application/pdf",
          upsert: false
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
        {
          name: file.name,
          size: file.size,
          type: file.type || "application/pdf"
        },
        name || file.name,
        {
          content,
          parsedContent
        }
      );

      return jsonResponse(resume, 201);

    } catch (err) {

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