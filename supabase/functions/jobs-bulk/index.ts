import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";
import { getUserFromRequest } from "../_shared/auth.ts";
import { readJobsForDuplicateCheck, addJob } from "../_shared/db.ts";
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

  const identity = await getUserFromRequest(req);
  if (!identity) return errorResponse("Unauthorized", 401);

  if (req.method === "GET") {
    const { readJobs } = await import("../_shared/db.ts");
    const { jobs } = await readJobs(identity.userId);
    const exportedAt = new Date().toISOString();
    return jsonResponse({
      exportedAt,
      count: jobs.length,
      jobs,
    });
  }

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

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

  const existingJobs = await readJobsForDuplicateCheck(identity.userId);

  function duplicateKey(j: { title?: string; company?: string; techStack?: string[] }): string {
    const title = (j.title ?? "").trim().toLowerCase();
    const company = (j.company ?? "").trim().toLowerCase();
    const tech = (Array.isArray(j.techStack) ? j.techStack : []).slice().sort();
    const techPart = tech.join("|").toLowerCase();
    return `${title}|${company}|${techPart}`;
  }

  const existingKeys = new Set(existingJobs.map(duplicateKey));

  const now = new Date().toISOString();
  const toCreate = incomingJobs.filter((j) => !existingKeys.has(duplicateKey(j)));

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
