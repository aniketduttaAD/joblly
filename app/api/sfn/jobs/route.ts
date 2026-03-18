import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { addJob, readJobs, readJobsPaginated } from "@/lib/server/jobs";
import type { JobRecord } from "@/lib/types";
import {
  MAX_ARRAY_ITEMS,
  MAX_LONG_TEXT_LENGTH,
  MAX_STRING_LENGTH,
  trimCap,
  trimCapArray,
} from "@/lib/server/validation";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const all = (url.searchParams.get("all") ?? "").trim() === "1";
  if (all) {
    try {
      const { jobs, updatedAt } = await readJobs(identity.userId);
      return json(req, { jobs, total: jobs.length, updatedAt });
    } catch (err) {
      console.error("GET /jobs error:", err);
      return json(req, { error: "Failed to read jobs" }, { status: 500 });
    }
  }

  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "20", 10)));

  try {
    const result = await readJobsPaginated(identity.userId, page, limit);
    return json(req, result);
  } catch (err) {
    console.error("GET /jobs error:", err);
    return json(req, { error: "Failed to read jobs" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json(req, { error: "Invalid JSON body" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const job: JobRecord = {
    id: crypto.randomUUID(),
    title: trimCap(body.title, MAX_STRING_LENGTH) ?? "",
    company: trimCap(body.company, MAX_STRING_LENGTH) ?? "",
    companyPublisher: trimCap(body.companyPublisher, MAX_STRING_LENGTH) ?? null,
    location: trimCap(body.location, MAX_STRING_LENGTH) ?? "",
    salaryMin: typeof body.salaryMin === "number" ? body.salaryMin : null,
    salaryMax: typeof body.salaryMax === "number" ? body.salaryMax : null,
    salaryCurrency: trimCap(body.salaryCurrency, 3) ?? null,
    salaryPeriod:
      body.salaryPeriod === "hourly" || body.salaryPeriod === "monthly"
        ? body.salaryPeriod
        : "yearly",
    salaryEstimated: typeof body.salaryEstimated === "boolean" ? body.salaryEstimated : false,
    techStack: trimCapArray(body.techStack, MAX_ARRAY_ITEMS),
    techStackNormalized: (body.techStackNormalized as any) ?? null,
    role: trimCap(body.role, MAX_STRING_LENGTH) ?? "",
    experience: trimCap(body.experience, MAX_STRING_LENGTH) ?? "Not specified",
    jobType: trimCap(body.jobType, 64) ?? null,
    availability: trimCap(body.availability, 64) ?? null,
    product: trimCap(body.product, MAX_STRING_LENGTH) ?? null,
    seniority: trimCap(body.seniority, 64) ?? null,
    collaborationTools: trimCapArray(body.collaborationTools, 64) ?? null,
    status: ["applied", "screening", "interview", "offer", "rejected", "withdrawn"].includes(
      body.status as string
    )
      ? (body.status as JobRecord["status"])
      : "applied",
    appliedAt: trimCap(body.appliedAt, 128) ?? now,
    postedAt: trimCap(body.postedAt, 128) ?? null,
    applicantsCount: typeof body.applicantsCount === "number" ? body.applicantsCount : null,
    education: trimCap(body.education, 2000) ?? null,
    source: trimCap(body.source, 512) ?? undefined,
    jdRaw: trimCap(body.jdRaw, MAX_LONG_TEXT_LENGTH) ?? undefined,
    notes: trimCap(body.notes, MAX_LONG_TEXT_LENGTH) ?? undefined,
    createdAt: now,
    updatedAt: now,
  };

  try {
    const created = await addJob(job, identity);
    return json(req, created, { status: 201 });
  } catch (err) {
    console.error("POST /jobs error:", err);
    return json(req, { error: "Failed to create job" }, { status: 500 });
  }
}
