import OpenAI from "openai";
import { ParseError } from "./errors";
import { withTimeout, extractJSON, retryWithBackoff } from "./utils";
import { getSystemPrompt } from "./prompt";
import type { ParseResult } from "./normalization";
import { JD_PARSE_MODEL, MAX_TOKENS_RESPONSE, OPENAI_TIMEOUT_MS } from "./constants";

function getOpenAI(apiKey?: string | null) {
  const key = apiKey?.trim() || "";
  return new OpenAI({ apiKey: key, timeout: OPENAI_TIMEOUT_MS });
}

export async function callOpenAI(
  content: string,
  jdWasTruncated: boolean,
  apiKey?: string | null
): Promise<ParseResult> {
  const openai = getOpenAI(apiKey);
  const completion = await withTimeout(
    openai.chat.completions.create({
      model: JD_PARSE_MODEL,
      messages: [
        { role: "system", content: getSystemPrompt() },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      temperature: 0.15,
      max_tokens: MAX_TOKENS_RESPONSE,
    }),
    OPENAI_TIMEOUT_MS,
    "Request timeout - parsing took too long"
  );

  if (!completion?.choices?.length) {
    throw new ParseError("Invalid response structure from OpenAI");
  }

  const rawContent = completion.choices[0]?.message?.content;
  if (!rawContent) throw new ParseError("Empty response from OpenAI");

  const finishReason = completion.choices[0]?.finish_reason;
  const responseTruncated = finishReason === "length";

  if (finishReason === "content_filter") {
    throw new ParseError("Response filtered by OpenAI content policy");
  }
  if (finishReason === "stop" && rawContent.length < 10) {
    throw new ParseError("Response too short - likely incomplete");
  }
  if (responseTruncated) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[Parse] Response truncated (${rawContent.length} chars) - tech stack may be incomplete`
      );
    }
  }

  try {
    const parsed = JSON.parse(rawContent) as ParseResult;
    if (jdWasTruncated || responseTruncated) {
      parsed._warnings = {
        jdTruncated: jdWasTruncated,
        responseTruncated: responseTruncated,
      };
    }
    return parsed;
  } catch {
    const fixedContent = extractJSON(rawContent);
    try {
      const parsed = JSON.parse(fixedContent) as ParseResult;
      if (jdWasTruncated || responseTruncated) {
        parsed._warnings = {
          jdTruncated: jdWasTruncated,
          responseTruncated: responseTruncated,
        };
      }
      return parsed;
    } catch (parseError) {
      if (process.env.NODE_ENV === "development") {
        console.error("[Parse] JSON parse failed:", rawContent.slice(0, 500));
      }
      throw new ParseError("Invalid JSON in parse response", true);
    }
  }
}

export { retryWithBackoff };
