import type { NextRequest } from "next/server";
import { getAllowedOrigins } from "./cors";

export function isApiAuthorized(req: NextRequest): boolean {
  const apiKey = (process.env.API_KEY ?? "").trim();
  if (apiKey) {
    const keyHeader = req.headers.get("x-api-key");
    if (keyHeader && keyHeader === apiKey) return true;
  }

  const allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.length > 0) {
    const origin = req.headers.get("origin") ?? req.headers.get("referer") ?? "";
    if (allowedOrigins.some((o) => origin.startsWith(o))) return true;
  }

  return false;
}
