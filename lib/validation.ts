const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const MAX_STRING_LENGTH = 2_000;

export const MAX_LONG_TEXT_LENGTH = 100_000;

export const MAX_JD_PARSE_LENGTH = 60_000;

export const MAX_ARRAY_ITEMS = 200;

export const MAX_BULK_IDS = 200;

export const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function isValidUUID(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}

export function validateUUID(id: unknown): string | null {
  if (isValidUUID(id)) return id;
  return null;
}

export function trimCap(value: unknown, maxLen: number = MAX_STRING_LENGTH): string | undefined {
  if (value == null) return undefined;
  const s = String(value).trim();
  if (!s) return undefined;
  return s.length > maxLen ? s.slice(0, maxLen) : s;
}

export function trimCapArray(
  value: unknown,
  maxItems: number = MAX_ARRAY_ITEMS,
  itemMaxLen: number = 500
): string[] {
  if (!Array.isArray(value)) return [];
  const arr = value
    .slice(0, maxItems)
    .map((v) => String(v).trim())
    .filter(Boolean);
  return arr.map((s) => (s.length > itemMaxLen ? s.slice(0, itemMaxLen) : s));
}

export const PATCH_JOB_ALLOWED_KEYS = [
  "title",
  "company",
  "companyPublisher",
  "location",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
  "salaryEstimated",
  "techStack",
  "techStackNormalized",
  "role",
  "experience",
  "jobType",
  "availability",
  "product",
  "seniority",
  "collaborationTools",
  "status",
  "appliedAt",
  "postedAt",
  "applicantsCount",
  "education",
  "source",
  "jdRaw",
  "notes",
] as const;

export type PatchJobAllowedKey = (typeof PATCH_JOB_ALLOWED_KEYS)[number];

const PATCH_KEYS_SET = new Set<string>(PATCH_JOB_ALLOWED_KEYS);

export function sanitizePatchBody(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    if (PATCH_KEYS_SET.has(key)) out[key] = body[key];
  }
  return out;
}

const PATCH_LONG_TEXT_KEYS = new Set(["jdRaw", "notes"]);
const PATCH_ARRAY_KEYS = new Set(["techStack", "collaborationTools"]);

export function sanitizePatchValues(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (PATCH_ARRAY_KEYS.has(key)) {
      out[key] = trimCapArray(value, MAX_ARRAY_ITEMS);
    } else if (PATCH_LONG_TEXT_KEYS.has(key)) {
      out[key] = value != null ? trimCap(value, MAX_LONG_TEXT_LENGTH) : value;
    } else if (key === "salaryEstimated") {
      out[key] = typeof value === "boolean" ? value : value === true || value === "true";
    } else if (typeof value === "string") {
      out[key] = trimCap(value, MAX_STRING_LENGTH) ?? value;
    } else {
      out[key] = value;
    }
  }
  return out;
}
