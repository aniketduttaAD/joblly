import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const apiKey = req.headers.get("x-openai-api-key") ?? Deno.env.get("OPENAI_API_KEY") ?? null;

  if (!apiKey) {
    return errorResponse("OpenAI API key not provided", 400);
  }

  let body: { text?: unknown; entityId?: unknown; entityType?: unknown; section?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const text = body.text;
  if (!text || typeof text !== "string" || !text.trim()) {
    return errorResponse("'text' field is required", 400);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.trim(),
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      return errorResponse(`OpenAI API error: ${response.status} ${err}`, 502);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;

    if (!Array.isArray(embedding)) {
      return errorResponse("Invalid embedding response from OpenAI", 502);
    }

    return jsonResponse({
      embedding,
      id: crypto.randomUUID(),
      entityId: body.entityId ?? null,
      entityType: body.entityType ?? null,
      section: body.section ?? null,
      text: text.trim(),
    });
  } catch (err) {
    console.error("POST /embeddings-generate error:", err);
    return errorResponse("Failed to generate embedding", 500);
  }
});
