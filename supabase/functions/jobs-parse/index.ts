import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import {
  parseJobDescription,
  parseResultToJobRecord,
  ParseError,
} from "../_shared/openai-parse.ts";

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Request timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const apiKey = req.headers.get("x-openai-api-key") ?? Deno.env.get("OPENAI_API_KEY") ?? null;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const jdText = (body.jd ?? body.text ?? "") as string;
  if (!jdText || typeof jdText !== "string") {
    return errorResponse("Missing required field: jd or text", 400);
  }

  try {
    const result = await withDeadline(parseJobDescription(jdText, apiKey), 50_000);
    const jobRecord = parseResultToJobRecord(result, jdText);
    return jsonResponse({
      parsed: result,
      record: jobRecord,
      result,
      jobRecord,
    });
  } catch (err) {
    if (err instanceof ParseError) {
      return errorResponse(err.message, 400);
    }
    if (err instanceof Error && err.message.includes("timeout")) {
      return errorResponse("Parsing timed out. Try with a shorter job description.", 408);
    }
    console.error("POST /jobs-parse error:", err);
    return errorResponse("Failed to parse job description", 500);
  }
});
