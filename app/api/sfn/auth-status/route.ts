import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;
  return json(req, { authRequired: true });
}
