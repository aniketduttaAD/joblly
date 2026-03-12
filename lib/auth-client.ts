"use client";

import { sfn } from "@/lib/supabase-api";
import { supabaseBrowserClient } from "@/lib/supabase-browser";

export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
};

async function getCurrentAccessToken(): Promise<string | null> {
  const { data, error } = await supabaseBrowserClient.auth.getSession();
  if (error) return null;
  return data.session?.access_token ?? null;
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const token = await getCurrentAccessToken();
    if (!token) return null;

    const response = await fetch(sfn("auth-me"), {
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;

    const data = (await response.json()) as { id?: string; email?: string; name?: string };
    if (!data.id) return null;
    return { id: data.id, email: data.email, name: data.name };
  } catch {
    return null;
  }
}

export async function sendEmailOtp(email: string): Promise<{ userId: string }> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail) {
    throw new Error("Email is required.");
  }

  const { error } = await supabaseBrowserClient.auth.signInWithOtp({
    email: trimmedEmail,
    options: {
      shouldCreateUser: true,
    },
  });

  if (error) {
    throw new Error(error.message || "Failed to send email code.");
  }

  return { userId: trimmedEmail };
}

export async function verifyEmailOtp(userId: string, secret: string): Promise<AuthUser> {
  const email = userId.trim().toLowerCase();
  const token = secret.trim();

  if (!email || !token) {
    throw new Error("Invalid or expired code.");
  }

  const { data, error } = await supabaseBrowserClient.auth.verifyOtp({
    email,
    token,
    type: "email",
  });

  if (error || !data.session || !data.session.user) {
    throw new Error(error?.message || "Invalid or expired code.");
  }

  const session = data.session;
  const user = session.user;

  return {
    id: user.id,
    email: user.email ?? undefined,
    name:
      (user.user_metadata?.full_name as string | undefined) ??
      (user.user_metadata?.name as string | undefined),
  };
}

export async function signOut(): Promise<void> {
  try {
    const token = await getCurrentAccessToken();
    if (token) {
      await fetch(sfn("auth-signout"), {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
    }
    await supabaseBrowserClient.auth.signOut();
  } catch {
  } finally {
  }
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const body = init.body;
  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
  const isBinary = typeof Blob !== "undefined" && body instanceof Blob;
  const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

  if (body && !headers.has("Content-Type") && !isMultipart && !isBinary && !isSearchParams) {
    headers.set("Content-Type", "application/json");
  }

  const token = await getCurrentAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (anonKey && !headers.has("apikey")) {
    headers.set("apikey", anonKey);
  }

  return fetch(input, { ...init, headers });
}
