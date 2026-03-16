"use client";

import { sfn } from "@/lib/supabase-api";

export type AuthUser = {
  id: string;
  email?: string;
  name?: string;
};

const AUTH_TOKEN_STORAGE_KEY = "jobtracker_auth_token";

function getStoredAuthToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredAuthToken(token: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {}
}

function clearStoredAuthToken(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {}
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const headers = new Headers();
    const token = getStoredAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }

    const response = await fetch(sfn("auth-me"), {
      cache: "no-store",
      credentials: "include",
      headers,
    });
    if (!response.ok) {
      if (response.status === 401) clearStoredAuthToken();
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

  // Keep returning the email as userId to avoid changing callers.
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
    setStoredAuthToken(data.token);
  }

  return {
    id: data.id,
    email: data.email ?? undefined,
    name: data.name ?? undefined,
  };
}

export async function signOut(): Promise<void> {
  try {
    const headers = new Headers();
    const token = getStoredAuthToken();
    if (token) {
      headers.set("Authorization", `Bearer ${token}`);
    }
    await fetch(sfn("auth-signout"), {
      method: "POST",
      credentials: "include",
      headers,
    });
  } catch {}
  clearStoredAuthToken();
}

export async function fetchWithAuth(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  const token = getStoredAuthToken();
  const body = init.body;
  const isMultipart = typeof FormData !== "undefined" && body instanceof FormData;
  const isBinary = typeof Blob !== "undefined" && body instanceof Blob;
  const isSearchParams = typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams;

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  if (body && !headers.has("Content-Type") && !isMultipart && !isBinary && !isSearchParams) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, { ...init, headers, credentials: "include" });
  if (response.status === 401) {
    clearStoredAuthToken();
  }
  return response;
}
