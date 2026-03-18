import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { searchJobsByTitleCompany } from "@/lib/server/jobs";
import type { JobStatus } from "@/lib/types";

const VALID_STATUSES = new Set<JobStatus>([
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
]);

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const statusParam = url.searchParams.get("status") ?? "";
  const status = VALID_STATUSES.has(statusParam as JobStatus)
    ? (statusParam as JobStatus)
    : undefined;
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
  const offset = Math.max(0, parseInt(url.searchParams.get("offset") ?? "0", 10) || 0);

  if (!q && !status) return json(req, { jobs: [], total: 0 });

  try {
    const result = await searchJobsByTitleCompany(identity.userId, q, status, { limit, offset });
    return json(req, result);
  } catch (err) {
    console.error("GET /jobs-search error:", err);
    return json(req, { error: "Search failed" }, { status: 500 });
  }
}
