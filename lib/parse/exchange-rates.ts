import OpenAI from "openai";
import { withTimeout } from "./utils";
import {
  EXCHANGE_RATE_TIMEOUT_MS,
  EXCHANGE_RATE_CACHE_TTL_MS,
  DEFAULT_EXCHANGE_RATES,
  OPENAI_TIMEOUT_MS,
} from "./constants";

let exchangeRateCache: { rates: Record<string, number>; timestamp: number } | null = null;

export async function getExchangeRatesToINR(
  apiKey?: string | null
): Promise<Record<string, number>> {
  const now = Date.now();

  if (exchangeRateCache && now - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_TTL_MS) {
    return exchangeRateCache.rates;
  }

  const key = apiKey?.trim();
  const openai = new OpenAI({ apiKey: key, timeout: OPENAI_TIMEOUT_MS });

  try {
    const response = await withTimeout(
      openai.chat.completions.create({
        model: "gpt-5-mini",
        messages: [
          {
            role: "system",
            content: `Return ONLY valid JSON with current exchange rates to INR. Format: {"USD": 83.5, "EUR": 90.2, ...}`,
          },
          {
            role: "user",
            content: `Current exchange rates to INR as of ${new Date().toISOString().split("T")[0]}?`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.1,
        max_tokens: 200,
      }),
      EXCHANGE_RATE_TIMEOUT_MS,
      "Exchange rate fetch timeout"
    );

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error("Empty exchange rate response");

    const rates = JSON.parse(content) as Record<string, number>;
    const validatedRates: Record<string, number> = {};

    for (const [currency, rate] of Object.entries(rates)) {
      const numRate = typeof rate === "number" ? rate : parseFloat(String(rate));
      if (Number.isFinite(numRate) && numRate > 0 && numRate < 10000) {
        validatedRates[currency.toUpperCase()] = numRate;
      }
    }

    if (Object.keys(validatedRates).length > 0) {
      exchangeRateCache = { rates: validatedRates, timestamp: now };
      return validatedRates;
    }
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("[Parse] Exchange rate fetch failed, using defaults");
    }
  }

  return DEFAULT_EXCHANGE_RATES;
}
