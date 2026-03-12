export function sfn(
  functionName: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const base = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/${functionName}`;
  if (!params) return base;

  const qs = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  return qs ? `${base}?${qs}` : base;
}
