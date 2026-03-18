import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

async function notFound(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;
  return json(req, { error: "Not found" }, { status: 404 });
}

export async function GET(req: NextRequest) {
  return notFound(req);
}

export async function POST(req: NextRequest) {
  return notFound(req);
}

export async function PUT(req: NextRequest) {
  return notFound(req);
}

export async function PATCH(req: NextRequest) {
  return notFound(req);
}

export async function DELETE(req: NextRequest) {
  return notFound(req);
}
