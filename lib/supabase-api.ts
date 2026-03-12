/**
 * Supabase Edge Function URL builder.
 *
 * Usage (client-side):
 *   import { sfn } from "@/lib/supabase-api";
 *   const url = sfn("jobs");           // https://<project>.supabase.co/functions/v1/jobs
 *   const url = sfn("jobs-by-id", { id: "abc" });  // ...jobs-by-id?id=abc
 *
 * NEXT_PUBLIC_SUPABASE_URL must be set in the environment.
 */

const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  (typeof window !== "undefined"
    ? ((window as unknown as Record<string, string>).__NEXT_PUBLIC_SUPABASE_URL__ ?? "")
    : "");

/**
 * Returns the full URL for a Supabase Edge Function, optionally appending
 * query parameters from `params`.
 */
export function sfn(
  functionName: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const base = `${SUPABASE_URL}/functions/v1/${functionName}`;
  if (!params) return base;

  const qs = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  return qs ? `${base}?${qs}` : base;
}
