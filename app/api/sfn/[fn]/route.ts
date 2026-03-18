import { NextResponse, type NextRequest } from "next/server";

const ALLOWED_FUNCTIONS = new Set<string>([
  "auth-me",
  "auth-refresh",
  "auth-send-otp",
  "auth-verify-otp",
  "auth-signout",
  "auth-status",
  "jobs",
  "jobs-by-id",
  "jobs-bulk",
  "jobs-external",
  "jobs-parse",
  "jobs-search",
  "jobs-stats",
  "resumes",
  "resume-by-id",
  "resume-file",
  "missing-resume-gaps",
  "cover-letter",
  "jd-extract",
  "ats-resume",
  "chat",
  "telegram-webhook",
]);

function normalizeOrigin(value: string | null | undefined): string {
  return (value ?? "").trim().replace(/\/$/, "");
}

function getAllowedSiteOrigins(): string[] {
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

function assertSameOriginForStateChange(req: NextRequest) {
  const origin = normalizeOrigin(req.headers.get("origin"));
  if (!origin) return;

  const allowed = getAllowedSiteOrigins();
  if (allowed.length === 0) return;

  if (!allowed.includes(origin)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
}

function getSupabaseFunctionsBaseUrl(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  if (!base) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not configured");
  return `${base}/functions/v1`;
}

async function proxy(req: NextRequest, fn: string) {
  if (!ALLOWED_FUNCTIONS.has(fn)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const method = req.method.toUpperCase();
  if (
    method !== "GET" &&
    method !== "POST" &&
    method !== "PUT" &&
    method !== "PATCH" &&
    method !== "DELETE"
  ) {
    return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  }

  if (method !== "GET") {
    const forbidden = assertSameOriginForStateChange(req);
    if (forbidden) return forbidden;
  }

  const upstreamUrl = new URL(`${getSupabaseFunctionsBaseUrl()}/${fn}`);
  upstreamUrl.search = req.nextUrl.search;

  const headers = new Headers();

  const passthrough = [
    "authorization",
    "content-type",
    "cookie",
    "x-api-key",
    "x-client-info",
    "apikey",
    "x-jobs-api-key",
    "x-forwarded-for",
    "x-real-ip",
    "cf-connecting-ip",
    "origin",
    "referer",
  ] as const;

  for (const name of passthrough) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  if (!headers.has("origin")) {
    const allowed = getAllowedSiteOrigins();
    if (allowed[0]) headers.set("origin", allowed[0]);
  }

  const init: RequestInit = {
    method,
    headers,
    redirect: "manual",
  };

  if (method !== "GET") {
    const body = await req.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }

  const upstream = await fetch(upstreamUrl, init);

  const response = new NextResponse(upstream.body, { status: upstream.status });

  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (lower === "content-encoding") continue;
    if (lower === "transfer-encoding") continue;
    if (lower === "connection") continue;
    if (lower.startsWith("access-control-")) continue;
    if (lower === "set-cookie") continue;
    response.headers.set(key, value);
  }

  const getSetCookie = (upstream.headers as unknown as { getSetCookie?: () => string[] })
    .getSetCookie;
  const setCookies = typeof getSetCookie === "function" ? getSetCookie.call(upstream.headers) : [];
  if (setCookies.length > 0) {
    for (const cookie of setCookies) response.headers.append("Set-Cookie", cookie);
  } else {
    const raw = upstream.headers.get("set-cookie");
    if (raw) response.headers.set("Set-Cookie", raw);
  }

  return response;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return proxy(req, fn);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return proxy(req, fn);
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return proxy(req, fn);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return proxy(req, fn);
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ fn: string }> }) {
  const { fn } = await ctx.params;
  return proxy(req, fn);
}
