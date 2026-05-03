import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import { clearSessionCookies } from "@/lib/server/auth";
import { clearAiCookies } from "@/lib/server/ai-cookies";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const res = json(req, { success: true });
  for (const cookie of clearSessionCookies()) {
    res.headers.append("Set-Cookie", cookie);
  }
  for (const cookie of clearAiCookies()) {
    res.headers.append("Set-Cookie", cookie);
  }
  return res;
}
