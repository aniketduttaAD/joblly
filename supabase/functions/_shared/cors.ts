declare const Deno: { env: { get: (key: string) => string | undefined } };

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/$/, "");
}

function getAllowedOrigins(): string[] {
  const raw = (Deno.env.get("SITE_URL") ?? "").trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const normalized = parsed
          .filter((v): v is string => typeof v === "string")
          .map(normalizeOrigin)
          .filter((v) => v && v !== "*");
        return normalized;
      }
    } catch {
      return [];
    }
  }

  return [];
}

function getCorsHeaders(originHeader: string | null): Record<string, string> {
  const origin = normalizeOrigin(originHeader ?? "");
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
