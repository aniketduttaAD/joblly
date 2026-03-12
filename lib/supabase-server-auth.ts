import { cookies, headers } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type SupabaseClient = ReturnType<typeof createClient>;

function getSupabaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
}

function getAnonKey(): string {
  // Reuse the existing publishable key env var
  return (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "").trim();
}

export function isSupabaseAuthConfigured(): boolean {
  return getSupabaseUrl().length > 0 && getAnonKey().length > 0;
}

export function createSupabaseServerClient(request?: NextRequest): SupabaseClient {
  const url = getSupabaseUrl();
  const anonKey = getAnonKey();

  return createClient(url, anonKey, {
    auth: {
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: request
        ? {
            Authorization: request.headers.get("authorization") ?? "",
          }
        : {},
    },
  });
}

export async function getSupabaseUserFromRequest(request: NextRequest) {
  if (!isSupabaseAuthConfigured()) {
    return { user: null };
  }

  const supabase = createSupabaseServerClient(request);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return { user: null };
  }

  return { user: data.user };
}

export function clearSupabaseAuthCookies(response: NextResponse) {
  const cookieNames = ["sb-access-token", "sb-refresh-token", "jobtracker_session"];

  for (const name of cookieNames) {
    response.cookies.set({
      name,
      value: "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }
}
