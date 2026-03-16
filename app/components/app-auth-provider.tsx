"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Loader2, Lock } from "lucide-react";
import {
  fetchWithAuth,
  getCurrentUser,
  sendEmailOtp,
  signOut,
  verifyEmailOtp,
  type AuthUser,
} from "@/lib/auth-client";
import { sfn } from "@/lib/supabase-api";

type AuthContextValue = {
  appFetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  authRequired: boolean;
  authenticated: boolean;
  ready: boolean;
  user: AuthUser | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-beige-50">
      <Loader2 className="h-8 w-8 animate-spin text-orange-brand" />
    </div>
  );
}

function AuthGate({
  authLoading,
  authEmail,
  authOtp,
  authStep,
  authError,
  onEmailChange,
  onOtpChange,
  onSendOtp,
  onVerifyOtp,
  onBack,
}: {
  authLoading: boolean;
  authEmail: string;
  authOtp: string;
  authStep: "email" | "otp";
  authError: string;
  onEmailChange: (value: string) => void;
  onOtpChange: (value: string) => void;
  onSendOtp: (event: React.FormEvent) => Promise<void>;
  onVerifyOtp: (event: React.FormEvent) => Promise<void>;
  onBack: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-stone-900/80 backdrop-blur-sm md:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
    >
      <div
        className="w-full max-w-md rounded-t-2xl border-t border-beige-300 bg-beige-50 p-6 shadow-xl md:rounded-2xl md:border md:border-beige-300 md:p-8"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mx-auto mb-6 flex h-12 w-12 items-center justify-center rounded-full bg-orange-brand/20">
          <Lock className="h-6 w-6 text-orange-brand" />
        </div>
        <h2 id="auth-title" className="text-center text-lg font-semibold text-stone-800">
          Sign in with Email OTP
        </h2>
        <p className="mt-1 text-center text-sm text-stone-500"></p>
        {authStep === "email" ? (
          <form onSubmit={onSendOtp} className="mt-6 space-y-4">
            <div>
              <label htmlFor="auth-email" className="sr-only">
                Email
              </label>
              <input
                id="auth-email"
                type="email"
                value={authEmail}
                onChange={(event) => onEmailChange(event.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                disabled={authLoading}
                className="w-full rounded-lg border border-beige-300 bg-white px-4 py-3 text-stone-800 placeholder-stone-400 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20 disabled:opacity-60"
              />
            </div>
            {authError && (
              <p className="text-sm text-red-600" role="alert">
                {authError}
              </p>
            )}
            <button
              type="submit"
              disabled={authLoading || !authEmail.trim()}
              className="w-full rounded-lg bg-orange-brand py-3 text-sm font-medium text-white hover:bg-orange-dark focus:outline-none focus:ring-2 focus:ring-orange-brand/30 disabled:opacity-60"
            >
              {authLoading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Sending code…
                </span>
              ) : (
                "Send code"
              )}
            </button>
          </form>
        ) : (
          <form onSubmit={onVerifyOtp} className="mt-6 space-y-4">
            <div className="rounded-lg border border-beige-300 bg-white p-3 text-sm text-stone-600">
              Code sent to <span className="font-medium text-stone-800">{authEmail}</span>.
            </div>
            <div>
              <label htmlFor="auth-otp" className="sr-only">
                One-time password
              </label>
              <input
                id="auth-otp"
                type="text"
                inputMode="numeric"
                maxLength={4}
                value={authOtp}
                onChange={(event) => onOtpChange(event.target.value)}
                placeholder="4-digit code"
                autoComplete="one-time-code"
                autoFocus
                disabled={authLoading}
                className="w-full rounded-lg border border-beige-300 bg-white px-4 py-3 text-center text-lg tracking-[0.35em] text-stone-800 placeholder:tracking-normal placeholder-stone-400 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20 disabled:opacity-60"
              />
            </div>
            {authError && (
              <p className="text-sm text-red-600" role="alert">
                {authError}
              </p>
            )}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onBack}
                disabled={authLoading}
                className="flex-1 rounded-lg border border-beige-300 bg-white py-3 text-sm font-medium text-stone-700 hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20 disabled:opacity-60"
              >
                Back
              </button>
              <button
                type="submit"
                disabled={authLoading || authOtp.trim().length !== 4}
                className="flex-1 rounded-lg bg-orange-brand py-3 text-sm font-medium text-white hover:bg-orange-dark focus:outline-none focus:ring-2 focus:ring-orange-brand/30 disabled:opacity-60"
              >
                {authLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Verifying…
                  </span>
                ) : (
                  "Verify code"
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authStep, setAuthStep] = useState<"email" | "otp">("email");
  const [authEmail, setAuthEmail] = useState("");
  const [authOtp, setAuthOtp] = useState("");
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const clearAuth = useCallback(() => {
    setAuthenticated(false);
    setUser(null);
    setAuthStep("email");
    setAuthError("");
    setAuthOtp("");
    setAuthUserId(null);
  }, []);

  const lastRevalidateRef = useRef<number>(0);
  const REVALIDATE_THROTTLE_MS = 60_000;

  const revalidateSession = useCallback(async (): Promise<boolean> => {
    if (!authRequired) {
      setAuthenticated(true);
      return true;
    }
    const now = Date.now();
    if (now - lastRevalidateRef.current < REVALIDATE_THROTTLE_MS) {
      return authenticated;
    }
    lastRevalidateRef.current = now;

    const nextUser = await getCurrentUser();
    if (!nextUser) {
      setAuthenticated(false);
      setUser(null);
      return false;
    }

    setAuthenticated(true);
    setUser(nextUser);
    return true;
  }, [authRequired, authenticated]);

  const appFetch = useCallback<AuthContextValue["appFetch"]>(
    async (input, init = {}) => {
      const response = await fetchWithAuth(input, init);
      if (response.status === 401) {
        clearAuth();
      }
      return response;
    },
    [clearAuth]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const nextUser = await getCurrentUser();
        if (cancelled) return;

        if (nextUser) {
          setAuthRequired(true);
          setAuthenticated(true);
          setUser(nextUser);
        } else {
          setAuthRequired(true);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !authRequired || authLoading || authStep === "otp") return;

    const revalidate = () => void revalidateSession();
    const revalidateIfVisible = () => {
      if (document.visibilityState === "visible") revalidate();
    };

    window.addEventListener("focus", revalidate);
    document.addEventListener("visibilitychange", revalidateIfVisible);

    return () => {
      window.removeEventListener("focus", revalidate);
      document.removeEventListener("visibilitychange", revalidateIfVisible);
    };
  }, [authLoading, authRequired, authStep, ready, revalidateSession]);

  const handleSendOtp = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setAuthError("");
      if (!authEmail.trim()) return;
      setAuthLoading(true);
      try {
        const data = await sendEmailOtp(authEmail.trim());
        setAuthUserId(data.userId);
        setAuthStep("otp");
        setAuthOtp("");
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : "Failed to send the email code.");
      } finally {
        setAuthLoading(false);
      }
    },
    [authEmail]
  );

  const handleVerifyOtp = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setAuthError("");
      if (!authUserId || !authOtp.trim()) return;
      setAuthLoading(true);
      try {
        const nextUser = await verifyEmailOtp(authUserId, authOtp.trim());
        setAuthenticated(true);
        setUser(nextUser);
        setAuthOtp("");
      } catch (error) {
        setAuthError(
          error instanceof Error
            ? error.message
            : "Invalid or expired code. Request a new one and try again."
        );
      } finally {
        setAuthLoading(false);
      }
    },
    [authOtp, authUserId]
  );

  const handleBack = useCallback(() => {
    setAuthStep("email");
    setAuthOtp("");
    setAuthUserId(null);
    setAuthError("");
  }, []);

  const signOutFn = useCallback(async () => {
    try {
      await signOut();
    } finally {
      clearAuth();
    }
  }, [clearAuth]);

  const value = useMemo<AuthContextValue>(
    () => ({
      appFetch,
      authRequired,
      authenticated,
      ready,
      signOut: signOutFn,
      user,
    }),
    [appFetch, authRequired, authenticated, ready, signOutFn, user]
  );

  return (
    <AuthContext.Provider value={value}>
      {!ready ? (
        <LoadingScreen />
      ) : authRequired && !authenticated ? (
        <AuthGate
          authLoading={authLoading}
          authEmail={authEmail}
          authOtp={authOtp}
          authStep={authStep}
          authError={authError}
          onEmailChange={(value) => {
            setAuthEmail(value);
            setAuthError("");
          }}
          onOtpChange={(value) => {
            setAuthOtp(value.replace(/\D/g, "").slice(0, 4));
            setAuthError("");
          }}
          onSendOtp={handleSendOtp}
          onVerifyOtp={handleVerifyOtp}
          onBack={handleBack}
        />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAppAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAppAuth must be used within AppAuthProvider");
  }
  return context;
}
