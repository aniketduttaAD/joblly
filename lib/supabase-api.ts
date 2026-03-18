export function sfn(
  functionName: string,
  params?: Record<string, string | number | boolean | undefined | null>
): string {
  const base =
    typeof window === "undefined"
      ? `${(process.env.SITE_URL ?? "").replace(/\/$/, "")}/api/sfn/${functionName}`
      : `/api/sfn/${functionName}`;
  if (!params) return base;

  const qs = Object.entries(params)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");

  return qs ? `${base}?${qs}` : base;
}
