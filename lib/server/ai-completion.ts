import type { AiProviderId } from "@/lib/server/ai-cookies";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function geminiStreamUrl(model: string, apiKey: string): string {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent`;
  const params = new URLSearchParams({ key: apiKey, alt: "sse" });
  return `${base}?${params.toString()}`;
}

function geminiGenerateUrl(model: string, apiKey: string): string {
  const base = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  return `${base}?key=${encodeURIComponent(apiKey)}`;
}

export type OpenAiStyleMessage = { role: string; content?: string | null };

function splitSystemAndRest(messages: OpenAiStyleMessage[]): {
  system: string;
  rest: OpenAiStyleMessage[];
} {
  const systemParts: string[] = [];
  const rest: OpenAiStyleMessage[] = [];
  for (const m of messages) {
    if (m.role === "system" && typeof m.content === "string") {
      systemParts.push(m.content);
    } else {
      rest.push(m);
    }
  }
  return { system: systemParts.join("\n\n"), rest };
}

function toGeminiContents(rest: OpenAiStyleMessage[]) {
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];
  for (const m of rest) {
    const text = typeof m.content === "string" ? m.content : "";
    if (m.role === "user") {
      contents.push({ role: "user", parts: [{ text }] });
    } else if (m.role === "assistant") {
      contents.push({ role: "model", parts: [{ text }] });
    }
  }
  return contents;
}

function encodeSse(content: string): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify({ content })}\n\n`);
}

async function pipeOpenAiStreamBody(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const content = parsed.choices?.[0]?.delta?.content ?? "";
        if (content) controller.enqueue(encodeSse(content));
      } catch {
        /* skip */
      }
    }
  }
  if (buffer.trim()) {
    const trimmed = buffer.trim();
    if (trimmed.startsWith("data: ")) {
      const data = trimmed.slice(6);
      if (data !== "[DONE]") {
        try {
          const parsed = JSON.parse(data) as {
            choices?: Array<{ delta?: { content?: string } }>;
          };
          const content = parsed.choices?.[0]?.delta?.content ?? "";
          if (content) controller.enqueue(encodeSse(content));
        } catch {
          /* skip */
        }
      }
    }
  }
}

function extractGeminiDeltaText(obj: unknown): string {
  if (!obj || typeof obj !== "object") return "";
  const c = obj as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };
  const parts = c.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("");
}

async function pipeGeminiSseBody(
  body: ReadableStream<Uint8Array>,
  controller: ReadableStreamDefaultController<Uint8Array>
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;
      const data = trimmed.slice(6).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as unknown;
        const text = extractGeminiDeltaText(parsed);
        if (text) controller.enqueue(encodeSse(text));
      } catch {
        /* skip */
      }
    }
  }
}

export type ChatStreamParams = {
  model: string;
  messages: OpenAiStyleMessage[];
  temperature: number;
  topP?: number;
  maxTokens: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
};

export function createAiChatSseStream(
  provider: AiProviderId,
  apiKey: string,
  params: ChatStreamParams
): ReadableStream<Uint8Array> {
  return new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);
      try {
        if (provider === "openai") {
          const res = await fetch(OPENAI_CHAT_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: params.model,
              messages: params.messages,
              temperature: params.temperature,
              top_p: params.topP ?? 0.9,
              max_tokens: params.maxTokens,
              ...(typeof params.frequencyPenalty === "number"
                ? { frequency_penalty: params.frequencyPenalty }
                : {}),
              ...(typeof params.presencePenalty === "number"
                ? { presence_penalty: params.presencePenalty }
                : {}),
              stream: true,
            }),
          });
          if (!res.ok) {
            const errorText = await res.text().catch(() => "");
            throw new Error(errorText || "OpenAI streaming request failed");
          }
          if (!res.body) throw new Error("No response stream from OpenAI");
          await pipeOpenAiStreamBody(res.body, controller);
        } else {
          const { system, rest } = splitSystemAndRest(params.messages);
          const contents = toGeminiContents(rest);
          const generationConfig: Record<string, number> = {
            temperature: params.temperature,
            topP: params.topP ?? 0.9,
            maxOutputTokens: params.maxTokens,
          };
          const geminiBody: Record<string, unknown> = {
            contents,
            generationConfig,
          };
          if (system.trim()) {
            geminiBody.systemInstruction = { parts: [{ text: system }] };
          }
          const res = await fetch(geminiStreamUrl(params.model, apiKey), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(geminiBody),
          });
          if (!res.ok) {
            const errorText = await res.text().catch(() => "");
            throw new Error(errorText || "Gemini streaming request failed");
          }
          if (!res.body) throw new Error("No response stream from Gemini");
          await pipeGeminiSseBody(res.body, controller);
        }
        controller.enqueue(encode("data: [DONE]\n\n"));
        controller.close();
      } catch (e) {
        controller.error(e);
      }
    },
  });
}

export async function completeChatJsonText(
  provider: AiProviderId,
  apiKey: string,
  params: {
    model: string;
    messages: OpenAiStyleMessage[];
    temperature: number;
    maxTokens: number;
  }
): Promise<string> {
  if (provider === "openai") {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        response_format: { type: "json_object" },
        temperature: params.temperature,
        max_tokens: params.maxTokens,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      error?: { message?: string };
    } | null;
    if (!res.ok) {
      throw new Error(data?.error?.message || "OpenAI request failed");
    }
    const raw = data?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") throw new Error("Empty response from OpenAI");
    return raw;
  }

  const { system, rest } = splitSystemAndRest(params.messages);
  const contents = toGeminiContents(rest);
  const geminiBody: Record<string, unknown> = {
    contents,
    generationConfig: {
      temperature: params.temperature,
      maxOutputTokens: params.maxTokens,
      responseMimeType: "application/json",
    },
  };
  if (system.trim()) {
    geminiBody.systemInstruction = { parts: [{ text: system }] };
  }

  const res = await fetch(geminiGenerateUrl(params.model, apiKey), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(geminiBody),
  });
  const data = (await res.json().catch(() => null)) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    error?: { message?: string };
  } | null;
  if (!res.ok) {
    throw new Error(data?.error?.message || "Gemini request failed");
  }
  const parts = data?.candidates?.[0]?.content?.parts;
  const raw = Array.isArray(parts) ? parts.map((p) => p.text ?? "").join("") : "";
  if (!raw.trim()) throw new Error("Empty response from Gemini");
  return raw;
}
