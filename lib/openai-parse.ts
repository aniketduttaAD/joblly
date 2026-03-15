import type { JobRecord } from "./types";
import { ParseError } from "./parse/errors";
import { MAX_JD_CHARS } from "./parse/constants";
import { callOpenAI, retryWithBackoff } from "./parse/openai-client";
import {
  normalizeParseResult,
  validateAndFixRequired,
  type ParseResult,
} from "./parse/normalization";

export type { ParseResult };

export async function parseJobDescription(
  jdText: string,
  apiKey?: string | null
): Promise<ParseResult> {
  const startTime = Date.now();

  const key = (apiKey?.trim() || process.env.OPENAI_API_KEY || "").trim();
  if (!key) {
    throw new ParseError("OpenAI API key is not configured on the server.");
  }

  if (typeof jdText !== "string") {
    throw new ParseError("Job description must be a string");
  }

  const text = jdText.trim();
  if (!text) {
    throw new ParseError("Job description text is empty");
  }

  const jdWasTruncated = text.length > MAX_JD_CHARS;
  const content = text.length <= MAX_JD_CHARS ? text : text.slice(0, MAX_JD_CHARS);

  if (jdWasTruncated) {
    const warning = `[Parse] WARNING: JD truncated from ${text.length} to ${MAX_JD_CHARS} chars. Some information may be missing.`;
    if (process.env.NODE_ENV === "development") {
      console.warn(warning);
    }
  }

  try {
    const parsed = await retryWithBackoff(() => callOpenAI(content, jdWasTruncated, apiKey));

    validateAndFixRequired(parsed);

    const normalized = await normalizeParseResult(parsed, text, apiKey);

    if (parsed._warnings) {
      (normalized as ParseResult)._warnings = parsed._warnings;
    }

    if (process.env.NODE_ENV === "development") {
      const warnings = normalized._warnings;
      const warningMsg = warnings
        ? ` [WARNINGS: ${warnings.jdTruncated ? "JD truncated" : ""}${
            warnings.jdTruncated && warnings.responseTruncated ? ", " : ""
          }${warnings.responseTruncated ? "Response truncated" : ""}]`
        : "";
      console.log(`[Parse] Completed in ${Date.now() - startTime}ms${warningMsg}`);
    }

    return normalized;
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.error(`[Parse] Failed after ${Date.now() - startTime}ms`);
    }
    throw error;
  }
}

export function parseResultToJobRecord(
  result: ParseResult,
  jdRaw?: string
): Omit<JobRecord, "id" | "createdAt" | "updatedAt"> {
  const now = new Date().toISOString();
  return {
    title: result.title,
    company: result.company,
    companyPublisher: result.companyPublisher ?? undefined,
    location: result.location,
    salaryMin: result.salaryMin,
    salaryMax: result.salaryMax,
    salaryCurrency: result.salaryCurrency,
    salaryPeriod: result.salaryPeriod ?? "yearly",
    salaryEstimated: result.salaryEstimated ?? false,
    techStack: result.techStack,
    techStackNormalized: result.techStackNormalized ?? undefined,
    role: result.role,
    experience: result.experience,
    jobType: result.jobType ?? undefined,
    availability: result.availability ?? undefined,
    product: result.product ?? undefined,
    seniority: result.seniority ?? undefined,
    collaborationTools: result.collaborationTools ?? undefined,
    status: "applied",
    appliedAt: now,
    postedAt: result.postedAt ?? undefined,
    applicantsCount: result.applicantsCount ?? undefined,
    education: result.education ?? undefined,
    source: result.source || undefined,
    jdRaw: jdRaw ?? undefined,
  };
}
