import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, errorResponse } from "../_shared/cors.ts";
import { corsHeaders } from "../_shared/cors.ts";

function buildPhase1Prompt(): string {
  return `You are a job applicant writing a cover letter. Write AS YOURSELF, using ONLY information from your resume and the job description.

PHASE 1: EVIDENCE-FIRST APPROACH

CONSTRAINTS:
1. Every claim must map to resume or JD evidence
2. Use specific details: company names, projects, technologies, dates, numbers
3. Write in first person
4. Use past tense for experience
5. Be direct and factual

WRITING STYLE:
- Natural but professional
- Mix sentence lengths
- Use contractions inconsistently
- Vary sentence starters

AVOID:
- Corporate buzzwords: "leveraged", "synergized", "empowered", "utilized"
- Meta-commentary
- AI overused phrases (fixed in Phase 3)`;
}

function buildPhase2Prompt(): string {
  return `You are a job applicant writing a cover letter. Write AS YOURSELF, using ONLY information from your resume and the job description.

PHASE 2: CONVERSATIONAL APPROACH

CONSTRAINTS:
1. Every claim must map to resume or JD evidence
2. Write like you're speaking conversationally but professionally
3. Use natural language patterns - vary from Phase 1's structure

WRITING STYLE:
- Conversational but professional
- Natural transitions or no transition
- Occasional fragments
- Mix verb forms

AVOID:
- Corporate buzzwords
- Meta-commentary
- AI overused phrases (fixed in Phase 3)
- Same structure as Phase 1`;
}

function buildPhase3Prompt(): string {
  return `You are combining two cover letter responses into a final professional, human, conversational cover letter (3-4 paragraphs).

PHASE 3: COMBINE AND REFINE

Combine the best of Phase 1 and Phase 2, apply all constraints:

1. EVIDENCE-FIRST: Every claim maps to resume/JD evidence
2. SENTENCE RHYTHM: Mix short, medium, longer sentences
3. VERB DISCIPLINE: Use "built", "led", "improved", "created". Avoid "leveraged", "spearheaded", "utilized"
4. NO META-COMMENTARY: Remove "This demonstrates...", "I believe..."
5. FORMAT: Proper business letter format, 3-4 paragraphs

CRITICAL - REPLACE ALL AI PHRASES:
❌ "I'm drawn to" → state interest directly
❌ "aligning with" → "matches" or restructure
❌ "excites me" → "I want to" or state the fact
❌ "I look forward to" → remove or "I want to"
❌ "pioneering work" → state what they do simply
❌ "meaningful impact", "fosters trust" → remove buzzwords
❌ "I am eager to" → "I want to"
❌ "which aligns well with" → "which matches"
❌ "I have hands-on experience" → "I've built" or "I worked on"
❌ "opportunity at" → "role at" or "position at"
❌ "collaborating on" → "working on" or "building"
❌ "mission of" → "focus on" or "goal of"

NATURAL VARIATION:
- Contractions inconsistently (like real speech)
- Natural transitions or none
- End naturally

GRAMMAR: Proper grammar throughout.

FORMAT: Business letter, 3-4 paragraphs. End naturally without forced conclusions.`;
}

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const apiKey = req.headers.get("x-openai-api-key");
  if (!apiKey) {
    return errorResponse("OpenAI API key not provided. Please set your API key in settings.", 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const { resumeData, jdData } = body;

  if (!resumeData || !jdData) {
    return errorResponse("Resume and JD data are required", 400);
  }
  if (!(resumeData as { isVerified?: boolean }).isVerified) {
    return errorResponse("Resume must be verified before use", 400);
  }

  const resumeContent = formatResumeContent(resumeData as ResumeData);
  const jdContent = (jdData as { content?: string }).content ?? "";

  const contextPrompt = `RESUME CONTENT:\n${resumeContent}\n\nJOB DESCRIPTION:\n${jdContent}\n\nUse ONLY the resume and job description above to write the cover letter.`;
  const coverLetterPrompt = `Write a professional cover letter for this job application. Be 3-4 paragraphs, connect experience to requirements, professional but conversational.`;

  const baseMessages = [
    { role: "user" as const, content: contextPrompt },
    { role: "user" as const, content: coverLetterPrompt },
  ];

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
                content: `PHASE 1 RESPONSE:\n\n${phase1Content}\n\nPHASE 2 RESPONSE:\n\n${phase2Content}\n\nCombine these cover letter responses, apply all constraints, and create a final human, professional, conversational cover letter.`,
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
  content: string;
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

function formatResumeContent(resume: ResumeData): string {
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
  content += `\nFULL TEXT:\n${resume.content}`;
  return content;
}
