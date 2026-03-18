import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { getUserFromRequest } from "@/lib/server/auth";
import { readJobsStats } from "@/lib/server/jobs";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const identity = await getUserFromRequest(req);
  if (!identity) return json(req, { error: "Unauthorized" }, { status: 401 });

  try {
    const stats = await readJobsStats(identity.userId);
    return json(req, stats);
  } catch (err) {
    console.error("GET /jobs-stats error:", err);
    return json(req, { error: "Failed to get stats" }, { status: 500 });
  }
}
