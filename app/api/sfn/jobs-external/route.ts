import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";

const EXTERNAL_API_BASE = "https://jobs.indianapi.in";
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 1500;

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req);
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);

  const apiKey =
    req.headers.get("x-api-key") ??
    req.headers.get("x-jobs-api-key") ??
    process.env.JOBS_API_KEY ??
    "";

  if (!apiKey) {
    return NextResponse.json({ error: "Missing X-Api-Key header" }, { status: 400, headers: cors });
  }

  const url = new URL(req.url);
  const params = new URLSearchParams();
  for (const key of ["limit", "title", "location", "job_type", "experience"]) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, RATE_LIMIT_DELAY_MS * attempt));

    try {
      const targetUrl = `${EXTERNAL_API_BASE}/jobs?${params.toString()}`;
      const res = await fetch(targetUrl, {
        headers: { "X-Api-Key": apiKey, Accept: "application/json" },
      });

      if (res.status === 429) {
        lastError = new Error("Rate limit hit");
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        return NextResponse.json(
          { error: `External API error: ${res.status} ${body}` },
          { status: 502, headers: cors }
        );
      }

      const data = await res.json();
      return NextResponse.json(data, { headers: cors });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  console.error("jobs-external: all retries failed", lastError);
  return NextResponse.json(
    { error: "Failed to fetch external jobs" },
    { status: 502, headers: cors }
  );
}
