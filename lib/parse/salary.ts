import OpenAI from "openai";
import { withTimeout, normalizeNumber } from "./utils";
import { SALARY_ESTIMATE_TIMEOUT_MS, OPENAI_TIMEOUT_MS } from "./constants";

export async function estimateSalaryOnline(
  role: string,
  experience: string,
  location: string,
  apiKey?: string | null
): Promise<{ min: number | null; max: number | null }> {
  const key = apiKey?.trim() || process.env.OPENAI_API_KEY || "";
  const openai = new OpenAI({ apiKey: key, timeout: OPENAI_TIMEOUT_MS });

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: `You are a salary research assistant. Research current market salary ranges for the given role, experience level, and location. Return ONLY valid JSON with salary range in INR (yearly). Format: {"min": number, "max": number} or {"min": number, "max": null} or {"min": null, "max": number}. Use realistic market rates based on current data. If you cannot find reliable data, return {"min": null, "max": null}.`,
          },
          {
            role: "user",
            content: `What is the typical salary range (in INR yearly) for a ${role} position requiring ${experience} of experience in ${location}? Research current market rates and provide a realistic range.`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 150,
      }),
      SALARY_ESTIMATE_TIMEOUT_MS,
      "Salary estimate timeout"
    );

    const content = response.choices[0]?.message?.content;
    if (!content) return { min: null, max: null };

    const result = JSON.parse(content) as { min?: number | null; max?: number | null };
    const min = normalizeNumber(result.min);
    const max = normalizeNumber(result.max);

    if (min != null && max != null && max < min) {
      return { min: max, max: min };
    }

    return { min, max };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Parse] Salary estimation failed:", error);
    }
    return { min: null, max: null };
  }
}

export function convertToINRYearly(
  salaryMin: number | null,
  salaryMax: number | null,
  currency: string,
  period: "hourly" | "monthly" | "yearly",
  exchangeRates: Record<string, number>
): { min: number | null; max: number | null } {
  if (salaryMin == null && salaryMax == null) {
    return { min: null, max: null };
  }

  let min = salaryMin;
  let max = salaryMax;

  if (currency && currency.toUpperCase() !== "INR") {
    const rate = exchangeRates[currency.toUpperCase()];
    if (rate && Number.isFinite(rate) && rate > 0) {
      if (min != null) min = Math.round(min * rate);
      if (max != null) max = Math.round(max * rate);
    }
  }

  const periodMultipliers: Record<string, number> = {
    hourly: 2080,
    monthly: 12,
    yearly: 1,
  };

  const multiplier = periodMultipliers[period] || 1;
  if (min != null) {
    const converted = min * multiplier;
    min = Number.isFinite(converted) && converted <= 1_000_000_000 ? Math.round(converted) : null;
  }
  if (max != null) {
    const converted = max * multiplier;
    max = Number.isFinite(converted) && converted <= 1_000_000_000 ? Math.round(converted) : null;
  }

  if (min != null && max != null && max < min) {
    [min, max] = [max, min];
  }

  return { min, max };
}
