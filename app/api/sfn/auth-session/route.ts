import { NextResponse, type NextRequest } from "next/server";
import { handleCors, json } from "@/lib/server/cors";
import {
  clearSessionCookies,
  createAppJwt,
  createSessionCookies,
  getAppJwtFromRequest,
  getRefreshTokenFromRequest,
  verifyAppJwt,
} from "@/lib/server/auth";
import { getSql } from "@/lib/server/neon";

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function GET(req: NextRequest) {
  const cors = handleCors(req);
  if (cors) return cors;

  const sql = getSql();

  const access = getAppJwtFromRequest(req);
  if (access) {
    const claims = await verifyAppJwt(access, "access");
    if (claims) {
      const rows = (await sql`
        select id, email, name from public.app_users where id = ${claims.userId} limit 1
      `) as Array<{ id: string; email: string; name: string | null }>;
      const row = rows[0] ?? null;
      return json(req, {
        id: claims.userId,
        email: row?.email ?? claims.email,
        name: row?.name ?? null,
      });
    }
  }

  const refresh = getRefreshTokenFromRequest(req);
  if (!refresh) {
    return json(req, { error: "Unauthorized" }, { status: 401 });
  }

  const refreshClaims = await verifyAppJwt(refresh, "refresh");
  if (!refreshClaims) {
    const res = json(req, { error: "Unauthorized" }, { status: 401 });
    for (const cookie of clearSessionCookies()) res.headers.append("Set-Cookie", cookie);
    return res;
  }

  const rows = (await sql`
    select id, email, name from public.app_users where id = ${refreshClaims.userId} limit 1
  `) as Array<{ id: string; email: string; name: string | null }>;
  const row = rows[0] ?? null;

  const accessToken = await createAppJwt(
    { sub: refreshClaims.userId, email: refreshClaims.email },
    5 * 60,
    "access"
  );

  const res = json(req, {
    id: refreshClaims.userId,
    email: row?.email ?? refreshClaims.email,
    name: row?.name ?? null,
    token: accessToken,
  });
  // Keep refresh cookie; rotate access cookie.
  for (const cookie of createSessionCookies({ accessToken, refreshToken: refresh })) {
    res.headers.append("Set-Cookie", cookie);
  }
  return res;
}
