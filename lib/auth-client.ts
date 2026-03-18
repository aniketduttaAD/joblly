"use client";

import { sfn } from "@/lib/supabase-api";

export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
};

const ACCESS_TOKEN_STORAGE_KEY = "jobtracker_access_token";

function readStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
}

function storeAccessToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (!token) {
    window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, token);
}

function withAccessToken(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  const token = readStoredAccessToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return { ...init, headers };
}

async function fetchWithRefresh(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(input, { ...withAccessToken(init), credentials: "include" });
  if (response.status !== 401 || input === sfn("auth-refresh")) {
    return response;
  }

  const refreshResponse = await fetch(sfn("auth-refresh"), {
    method: "POST",
    credentials: "include",
  });

  if (!refreshResponse.ok) {
    storeAccessToken(null);
    return response;
  }

  const refreshData = (await refreshResponse.json().catch(() => ({}))) as { token?: string };
  if (typeof refreshData.token === "string" && refreshData.token) {
    storeAccessToken(refreshData.token);
  }

  return fetch(input, { ...withAccessToken(init), credentials: "include" });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const response = await fetchWithRefresh(sfn("auth-me"), {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }

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

  const response = await fetch(sfn("auth-send-otp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email: trimmedEmail }),
  });

  if (!response.ok) {
    const message =
      (await response.json().catch(() => ({}) as any))?.error ?? "Failed to send email code.";
    throw new Error(typeof message === "string" ? message : "Failed to send email code.");
  }

  return { userId: trimmedEmail };
}

export async function verifyEmailOtp(userId: string, secret: string): Promise<AuthUser> {
  const email = userId.trim().toLowerCase();
  const code = secret.trim();

  if (!email || !code) {
    throw new Error("Enter the code from your email.");
  }

  const response = await fetch(sfn("auth-verify-otp"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, code }),
  });

  if (!response.ok) {
    const message =
      (await response.json().catch(() => ({}) as any))?.error ??
      "Unable to verify the code. Please request a new one and try again.";
    throw new Error(typeof message === "string" ? message : "Unable to verify the code.");
  }

  const data = (await response.json()) as {
    id?: string;
    email?: string;
    name?: string;
    token?: string;
  };
  if (!data.id) {
    throw new Error("Unable to verify the code.");
  }

  if (typeof data.token === "string" && data.token) {
    storeAccessToken(data.token);
  }

  return {
    id: data.id,
    email: data.email ?? undefined,
    name: data.name ?? undefined,
  };
}

export async function signOut(): Promise<void> {
  try {
    await fetch(sfn("auth-signout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {}
  storeAccessToken(null);
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

  return fetchWithRefresh(input, { ...init, headers });
}
