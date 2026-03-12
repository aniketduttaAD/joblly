import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

const EXTERNAL_API_BASE = "https://jobs.indianapi.in";
const MAX_RETRIES = 3;
const RATE_LIMIT_DELAY_MS = 1500;

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "GET") return errorResponse("Method not allowed", 405);

  const apiKey = req.headers.get("x-jobs-api-key") ?? Deno.env.get("JOBS_API_KEY") ?? "";
  if (!apiKey) return errorResponse("Missing X-Jobs-Api-Key header", 400);

  const url = new URL(req.url);
  const params = new URLSearchParams();

  for (const key of ["limit", "title", "location", "job_type", "experience"]) {
    const val = url.searchParams.get(key);
    if (val) params.set(key, val);
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(RATE_LIMIT_DELAY_MS * attempt);

    try {
      const targetUrl = `${EXTERNAL_API_BASE}/jobs?${params.toString()}`;
      const res = await fetch(targetUrl, {
        headers: {
          "X-Jobs-Api-Key": apiKey,
          Accept: "application/json",
        },
      });

      if (res.status === 429) {
        lastError = new Error("Rate limit hit");
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        return errorResponse(`External API error: ${res.status} ${body}`, 502);
      }

      const data = await res.json();
      return jsonResponse(data);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  console.error("jobs-external: all retries failed", lastError);
  return errorResponse("Failed to fetch external jobs", 502);
});
