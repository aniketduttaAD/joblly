import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { addJob, readJobs, readJobsForDuplicateCheck } from "@/lib/server/jobs";
import type { JobRecord } from "@/lib/types";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function DELETE(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;
  return json(req, { error: "Bulk delete is no longer supported" }, { status: 410 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const { jobs } = await readJobs(identity.userId);
  const exportedAt = new Date().toISOString();
  return json(req, { exportedAt, count: jobs.length, jobs });
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  let body: { jobs?: unknown[] };
  try {
    body = (await req.json()) as { jobs?: unknown[] };
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.jobs) || body.jobs.length === 0) {
    return json(
      req,
      { error: "Request body must include a non-empty 'jobs' array" },
      { status: 400 }
    );
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

  return json(req, {
    created,
    skipped: incomingJobs.length - toCreate.length,
    errors: errors.length > 0 ? errors : undefined,
  });
}
