import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { corsHeaders } from "../_shared/cors.ts";

const MAX_TOKENS_PER_REQUEST = 15_000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildPhase1Prompt(): string {
  return `You are a job applicant writing a response to an interview question. Write AS YOURSELF, using ONLY information from your resume and the job description.

PHASE 1: EVIDENCE-FIRST APPROACH

CONSTRAINTS:
1. Every claim must map to resume or JD evidence - no made-up information
2. Use specific details: company names, projects, technologies, dates, numbers
3. Write in first person ("I", "my", "me")
4. Use past tense for experience: "I built X", "I worked on Y"
5. Be direct and factual - state what you did
6. Reference specific resume sections naturally

WRITING STYLE:
- Natural but professional
- Mix sentence lengths: short (8-12 words), medium (15-20 words), occasional longer (22-28 words)
- Use contractions inconsistently: "I've" sometimes, "I have" other times
- Vary sentence starters: "At [Company], I...", "When I worked on...", "One project..."
- Active voice: "I built" not "I was involved in building"

AVOID:
- Corporate buzzwords: "leveraged", "synergized", "empowered", "utilized"
- Meta-commentary: "This demonstrates...", "I believe...", "This shows..."
- AI overused phrases (will be fixed in Phase 3)`;
}

function buildPhase2Prompt(): string {
  return `You are a job applicant writing a response to an interview question. Write AS YOURSELF, using ONLY information from your resume and the job description.

PHASE 2: CONVERSATIONAL APPROACH

CONSTRAINTS:
1. Every claim must map to resume or JD evidence - no made-up information
2. Write like you're speaking in an interview (conversational but professional)
3. Use natural language patterns - vary from Phase 1's structure
4. Be specific and concrete - avoid abstract concepts

WRITING STYLE:
- Conversational but professional - like explaining face-to-face
- Write like talking to a colleague, not writing an essay
- Use natural transitions: "Also", "Plus", "Another thing", or no transition
- Include occasional fragments: "Pretty straightforward." "Worked well."
- Mix verb forms: "I built" vs "I've built" vs "I was building"
- Use dashes for natural pauses: "I did X - that was challenging"

AVOID:
- Corporate buzzwords
- Meta-commentary
- AI overused phrases (will be fixed in Phase 3)
- Same structure as Phase 1`;
}

function buildPhase3Prompt(): string {
  return `You are combining two responses and creating a final professional, human, conversational response for a job interview.

PHASE 3: COMBINE AND REFINE

Combine the best of Phase 1 and Phase 2, apply all constraints:

1. EVIDENCE-FIRST: Every claim maps to resume/JD evidence
2. SENTENCE RHYTHM: Mix short (8-12), medium (15-20), longer (22-28) word sentences
3. VERB DISCIPLINE: Use "built", "led", "improved", "created", "developed". Avoid "leveraged", "spearheaded", "utilized"
4. NO META-COMMENTARY: Remove "This demonstrates...", "I believe...", "This shows..."
5. VERBOSITY CEILING: Stop when question is answered

CRITICAL - REPLACE ALL AI PHRASES:
❌ "I'm drawn to" → state interest directly
❌ "aligning with" → "matches" or restructure
❌ "excites me" → "I want to" or state the fact
❌ "I look forward to" → remove or "I want to"
❌ "pioneering work" → state what they do simply
❌ "meaningful impact" → remove buzzword
❌ "I am eager to" → "I want to"
❌ "which aligns well with" → "which matches"
❌ "I have hands-on experience" → "I've built" or "I worked on"
❌ "Based on my experience" → start with the experience directly
❌ "opportunity at" → "role at" or "position at"
❌ "collaborating on" → "working on" or "building"

NATURAL VARIATION:
- Contractions inconsistently (like real speech)
- Natural transitions: "Also", "Plus", "Another thing", or none
- Professional casual phrases: "pretty straightforward", "a lot of", "got to work with"
- End naturally when point is made

GRAMMAR: Proper grammar, subject-verb agreement, correct tenses, clear pronouns.

Your goal: Final response that sounds human and professional, not AI-generated.`;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const apiKey = (Deno.env.get("OPENAI_API_KEY") || "").trim();
  if (!apiKey) {
    return errorResponse("OpenAI API key is not configured on the server.", 500);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const {
    resumeData,
    jdData,
    question,
    extraInstructions,
    chatHistory,
    retrievedResumeSections,
    retrievedJDSections,
  } = body;

  if (!resumeData || !jdData) {
    return errorResponse("Resume and JD data are required", 400);
  }
  if (!question || typeof question !== "string") {
    return errorResponse("Question is required", 400);
  }

  const resumeContent = formatResumeContent(
    resumeData as ResumeData,
    retrievedResumeSections as string[]
  );
  const jdContent =
    retrievedJDSections && Array.isArray(retrievedJDSections) && retrievedJDSections.length > 0
      ? `RELEVANT SECTIONS:\n\n${(retrievedJDSections as string[]).map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`
      : ((jdData as { content?: string }).content ?? "");

  const contextPrompt = `RESUME CONTENT:\n${resumeContent}\n\nJOB DESCRIPTION:\n${jdContent}\n\nUse ONLY the resume and job description above to answer questions.`;
  const userPrompt = `QUESTION: ${question}${extraInstructions ? `\n\nEXTRA INSTRUCTIONS: ${extraInstructions}` : ""}`;

  const baseMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "user", content: contextPrompt },
  ];

  if (Array.isArray(chatHistory)) {
    for (const msg of chatHistory as Array<{ role: string; content: string }>) {
      if (msg.role === "user" || msg.role === "assistant") {
        baseMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
      }
    }
  }

  baseMessages.push({ role: "user", content: userPrompt });

  const allText = buildPhase1Prompt() + baseMessages.map((m) => m.content).join("\n");
  if (estimateTokens(allText) > MAX_TOKENS_PER_REQUEST) {
    return errorResponse("Request too large. Please shorten the resume or job description.", 429);
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);
      try {
        const p1Res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: buildPhase1Prompt() }, ...baseMessages],
            temperature: 0.8,
            top_p: 0.9,
            frequency_penalty: 0.4,
            presence_penalty: 0.3,
            stream: false,
          }),
        });
        const p1Data = await p1Res.json();
        const phase1Content = p1Data.choices?.[0]?.message?.content ?? "";
        if (!phase1Content.trim()) throw new Error("Failed to generate phase 1 response");

        const p2Res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [{ role: "system", content: buildPhase2Prompt() }, ...baseMessages],
            temperature: 0.85,
            top_p: 0.9,
            frequency_penalty: 0.5,
            presence_penalty: 0.4,
            stream: false,
          }),
        });
        const p2Data = await p2Res.json();
        const phase2Content = p2Data.choices?.[0]?.message?.content ?? "";
        if (!phase2Content.trim()) throw new Error("Failed to generate phase 2 response");

        const p3Res = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            messages: [
              { role: "system", content: buildPhase3Prompt() },
              {
                role: "user",
                content: `PHASE 1 RESPONSE:\n\n${phase1Content}\n\nPHASE 2 RESPONSE:\n\n${phase2Content}\n\nCombine these responses, apply all constraints, and create a final human, professional, conversational response.`,
              },
            ],
            temperature: 1.2,
            top_p: 0.8,
            frequency_penalty: 0.9,
            presence_penalty: 0.8,
            stream: true,
          }),
        });

        if (!p3Res.body) throw new Error("No stream body from Phase 3");

        const reader = p3Res.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          for (const line of chunk.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content ?? "";
              if (content) {
                controller.enqueue(encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
            } catch {}
          }
        }

        controller.enqueue(encode("data: [DONE]\n\n"));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

interface ResumeData {
  name: string;
  parsedContent: {
    skills?: string[];
    experience?: Array<{
      role: string;
      company: string;
      startDate: string;
      endDate?: string;
      description: string;
    }>;
    projects?: Array<{ name: string; description: string }>;
    education?: Array<{ degree: string; field?: string; institution: string }>;
  };
}

function formatResumeContent(resume: ResumeData, retrievedSections?: string[]): string {
  if (retrievedSections && retrievedSections.length > 0) {
    return `RESUME: ${resume.name}\n\nRELEVANT SECTIONS:\n\n${retrievedSections.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`;
  }

  let content = `RESUME: ${resume.name}\n\n`;
  const pc = resume.parsedContent;

  if (pc.skills?.length) content += `SKILLS: ${pc.skills.join(", ")}\n\n`;
  if (pc.experience?.length) {
    content += `EXPERIENCE:\n`;
    for (const e of pc.experience) {
      content += `- ${e.role} at ${e.company} (${e.startDate} - ${e.endDate || "Present"})\n  ${e.description}\n`;
    }
    content += "\n";
  }
  if (pc.projects?.length) {
    content += `PROJECTS:\n`;
    for (const p of pc.projects) content += `- ${p.name}: ${p.description}\n`;
    content += "\n";
  }
  if (pc.education?.length) {
    content += `EDUCATION:\n`;
    for (const e of pc.education)
      content += `- ${e.degree}${e.field ? ` in ${e.field}` : ""} from ${e.institution}\n`;
    content += "\n";
  }
  return content;
}
