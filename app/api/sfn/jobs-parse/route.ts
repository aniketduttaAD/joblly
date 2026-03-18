import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";
import { parseJobDescription, parseResultToJobRecord, ParseError } from "@/lib/server/openai-parse";

const PARSE_TIMEOUT_MS = 50_000;

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: cors });
  }

  const jdText = (body.jd ?? body.text ?? "") as string;
  if (!jdText || typeof jdText !== "string") {
    return NextResponse.json(
      { error: "Missing required field: jd or text" },
      { status: 400, headers: cors }
    );
  }

  try {
    const parsePromise = parseJobDescription(jdText);
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Request timeout")), PARSE_TIMEOUT_MS)
    );
    const result = await Promise.race([parsePromise, timeout]);
    const jobRecord = parseResultToJobRecord(result, jdText);

    return NextResponse.json(
      { parsed: result, record: jobRecord, result, jobRecord },
      { headers: cors }
    );
  } catch (err) {
    if (err instanceof ParseError) {
      return NextResponse.json({ error: err.message }, { status: 400, headers: cors });
    }
    if (err instanceof Error && err.message.includes("timeout")) {
      return NextResponse.json(
        { error: "Parsing timed out. Try with a shorter job description." },
        { status: 408, headers: cors }
      );
    }
    console.error("POST /jobs-parse error:", err);
    return NextResponse.json(
      { error: "Failed to parse job description" },
      { status: 500, headers: cors }
    );
  }
}
