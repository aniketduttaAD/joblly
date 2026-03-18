import { NextResponse, type NextRequest } from "next/server";

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

export function getAllowedOrigins(): string[] {
  const raw = (process.env.SITE_URL ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === "string")
      .map((v) => normalizeOrigin(v))
      .filter((v) => v && v !== "*");
  } catch {
    return [];
  }
}

export function corsHeadersForRequest(req: NextRequest): Record<string, string> {
  const origin = normalizeOrigin(req.headers.get("origin") ?? "");
  const allowed = getAllowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : "";

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type, x-api-key, x-jobs-api-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

export function corsHeaders(req: NextRequest): Record<string, string> {
  return corsHeadersForRequest(req);
}

export function withCors(req: NextRequest, res: NextResponse): NextResponse {
  const headers = corsHeadersForRequest(req);
  for (const [k, v] of Object.entries(headers)) {
    res.headers.set(k, v);
  }
  return res;
}

export function handleCors(req: NextRequest): NextResponse | null {
  if (req.method === "OPTIONS") {
    return withCors(req, new NextResponse(null, { status: 204 }));
  }
  return null;
}

export function handlePreflight(req: NextRequest): NextResponse {
  return handleCors(req) ?? withCors(req, new NextResponse(null, { status: 204 }));
}

export function json(req: NextRequest, data: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init);
  return withCors(req, res);
}
