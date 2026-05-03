import { NextRequest } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";
import { createAiChatSseStream } from "@/lib/server/ai-completion";
import { GEMINI_SIDE_MODEL, OPENAI_SIDE_MODEL } from "@/lib/server/ai-models";
import { resolveAiCredentials } from "@/lib/server/resolve-ai-credentials";

export const runtime = "nodejs";

function buildSystemPrompt(): string {
  return `You analyze what is missing in a candidate's resume for a specific job using ONLY the provided parsed resume data and job description.

Rules:
1. Be strict, factual, and concise.
2. Never invent skills, experience, or achievements.
3. Call out missing tools, missing years of experience, and missing leadership evidence clearly.
4. If the job is too senior for the resume, say that plainly.
5. Output in exactly this format:
Verdict: <one line>
Missing or weak areas:
- ...
Evidence already present:
- ...
What to improve in the resume:
- ...
6. Keep it under 220 words.
7. Do not write as the candidate. Write as an evaluator.`;
}

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
    rawText?: string;
  };
}

function formatResumeContent(resume: ResumeData): string {
  const pc = resume.parsedContent;
  const lines = [`Candidate: ${resume.name}`];
  if (pc.skills?.length) lines.push(`Skills: ${pc.skills.join(", ")}`);
  if (pc.experience?.length) {
    lines.push(
      `Experience:\n${pc.experience
        .slice(0, 4)
        .map(
          (entry) =>
            `- ${entry.role} at ${entry.company} (${entry.startDate} - ${entry.endDate || "Present"}): ${entry.description}`
        )
        .join("\n")}`
    );
  }
  if (pc.projects?.length) {
    lines.push(
      `Projects:\n${pc.projects
        .slice(0, 2)
        .map((project) => `- ${project.name}: ${project.description}`)
        .join("\n")}`
    );
  }
  if (pc.rawText) lines.push(`Summary excerpt: ${pc.rawText.replace(/\s+/g, " ").slice(0, 350)}`);
  return lines.join("\n\n");
}

export async function OPTIONS(req: NextRequest) {
  return handlePreflight(req);
}

export async function POST(req: NextRequest) {
  const cors = corsHeaders(req);

  const creds = resolveAiCredentials(req);
  if (!creds.ok) {
    return new Response(JSON.stringify({ error: creds.error }), {
      status: creds.status,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const resumeData = body.resumeData as ResumeData | undefined;
  const jdData = body.jdData as { content?: string } | undefined;
  const jobMetadata = body.jobMetadata as { title?: string; company?: string } | undefined;

  if (!resumeData || !jdData?.content?.trim()) {
    return new Response(JSON.stringify({ error: "Resume and job description are required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const resumeContent = formatResumeContent(resumeData);
  const jobContent = jdData.content!.trim().replace(/\s+/g, " ");
  const userPrompt = [
    jobMetadata?.title ? `ROLE TITLE: ${jobMetadata.title}` : "",
    jobMetadata?.company ? `COMPANY: ${jobMetadata.company}` : "",
    `PARSED RESUME:\n${resumeContent}`,
    `JOB DESCRIPTION:\n${jobContent.slice(0, 6000)}`,
    "TASK: Outline exactly what is missing or weak in the resume for this job, what evidence already exists, and what should be improved in the resume content.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = creds.provider === "openai" ? OPENAI_SIDE_MODEL : GEMINI_SIDE_MODEL;
  const stream = createAiChatSseStream(creds.provider, creds.apiKey, {
    model,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.15,
    topP: 0.9,
    maxTokens: 420,
  });

  return new Response(stream, {
    headers: {
      ...cors,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
