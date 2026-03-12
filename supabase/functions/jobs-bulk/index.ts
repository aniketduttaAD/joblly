import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { readJobs, addJob } from "../_shared/db.ts";
import type { JobRecord } from "../_shared/types.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method === "DELETE") {
    return new Response(JSON.stringify({ error: "Bulk delete is no longer supported" }), {
      status: 410,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  let body: { jobs?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  if (!Array.isArray(body.jobs) || body.jobs.length === 0) {
    return errorResponse("Request body must include a non-empty 'jobs' array", 400);
  }

  const incomingJobs = body.jobs as JobRecord[];

  // Deduplicate against existing jobs by title|company
  const { jobs: existingJobs } = await readJobs(identity.userId);
  const existingKeys = new Set(
    existingJobs.map((j) => `${j.title.toLowerCase()}|${j.company.toLowerCase()}`)
  );

  const now = new Date().toISOString();
  const toCreate = incomingJobs.filter((j) => {
    const key = `${(j.title ?? "").toLowerCase()}|${(j.company ?? "").toLowerCase()}`;
    return !existingKeys.has(key);
  });

  let created = 0;
  const errors: string[] = [];

  for (const job of toCreate) {
    try {
      const record: JobRecord = {
        ...job,
        id: job.id || crypto.randomUUID(),
        createdAt: job.createdAt || now,
        updatedAt: now,
        status: job.status || "applied",
        appliedAt: job.appliedAt || now,
        techStack: Array.isArray(job.techStack) ? job.techStack : [],
      };
      await addJob(record, identity);
      created++;
    } catch (err) {
      errors.push(`${job.title ?? "unknown"}: ${err instanceof Error ? err.message : "error"}`);
    }
  }

  return jsonResponse({
    created,
    skipped: incomingJobs.length - toCreate.length,
    errors: errors.length > 0 ? errors : undefined,
  });
});
