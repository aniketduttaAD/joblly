import { NextRequest } from "next/server";

const API_KEY = process.env.API_KEY ?? "";

function isSameOrigin(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function hasValidApiKey(request: NextRequest): boolean {
  if (!API_KEY) return false;
  const key =
    request.headers.get("x-api-key") ??
    request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim();
  return key === API_KEY;
}

export function isApiAuthorized(request: NextRequest): boolean {
  if (hasValidApiKey(request)) return true;
  if (isSameOrigin(request)) return true;
  return false;
}

export function isReadAuthorized(request: NextRequest): boolean {
  return isApiAuthorized(request);
}
