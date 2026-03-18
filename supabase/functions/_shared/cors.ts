declare const Deno: { env: { get: (key: string) => string | undefined } };

const DEFAULT_ALLOWED_ORIGINS = ["https://joblly.aniketdutta.space"] as const;

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function getAllowedOrigins(): string[] {
  const envList = (Deno.env.get("ALLOWED_ORIGINS") ?? "").trim();
  if (envList) {
    return envList.split(",").map(normalizeOrigin).filter(Boolean);
  }

  const siteUrl = normalizeOrigin(Deno.env.get("SITE_URL") ?? "");
  if (siteUrl && siteUrl !== "*") return [siteUrl];

  return [...DEFAULT_ALLOWED_ORIGINS];
}

function getCorsHeaders(originHeader: string | null): Record<string, string> {
  const origin = normalizeOrigin(originHeader ?? "");
  const allowed = getAllowedOrigins();
  const allowOrigin = origin && allowed.includes(origin) ? origin : (allowed[0] ?? "");

  return {
    ...(allowOrigin ? { "Access-Control-Allow-Origin": allowOrigin } : {}),
    Vary: "Origin",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-api-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  };
}

export function corsHeadersForRequest(req: Request): Record<string, string> {
  return getCorsHeaders(req.headers.get("origin"));
}

export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeadersForRequest(req) });
  }
  return null;
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
  req?: Request
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...getCorsHeaders(req?.headers.get("origin") ?? null),
      ...extraHeaders,
    },
  });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}
