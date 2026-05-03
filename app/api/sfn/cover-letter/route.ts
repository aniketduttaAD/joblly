import { NextRequest } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";
import { createAiChatSseStream } from "@/lib/server/ai-completion";
import { GEMINI_SIDE_MODEL, OPENAI_SIDE_MODEL } from "@/lib/server/ai-models";
import { resolveAiCredentials } from "@/lib/server/resolve-ai-credentials";

export const runtime = "nodejs";

function buildSystemPrompt(): string {
  return `You write concise, professional cover letters using ONLY the provided resume data, job metadata, and job description.

Rules:
1. Never invent facts, tools, leadership experience, years of experience, or achievements.
2. Never include placeholders, address blocks, dates, email lines, or phone numbers.
3. Use the candidate name exactly as provided.
4. If the role is more senior than the candidate's background, do not pretend otherwise. Write a credible letter that emphasizes honest strengths.
5. Keep the letter to 3 or 4 short paragraphs.
6. Start with "Dear Hiring Team,".
7. End with "Best regards," followed by the exact candidate name.
8. Do not output commentary, bullet points, or explanations. Output only the letter.
9. Use plain, natural language. No hype, no filler, no fake enthusiasm.
10. Focus on the most relevant overlap between resume and job description.
11. Proofread before answering: correct grammar, spacing, and punctuation. Avoid awkward phrasing.
12. Keep sentences short and direct. Avoid repeating the same idea twice.
13. If you mention a company/role/project, it must appear in the provided resume text.`;
}

type JobMetadata = { title?: string; company?: string; location?: string; aboutCompany?: string };
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

function extractSummary(rawText?: string): string {
  if (!rawText) return "";
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const match = normalized.match(
    /(?:professional summary|summary)\s+(.+?)(?:technical skills|work experience|experience|projects|education)/i
  );
  return (match?.[1] ?? normalized.slice(0, 280)).trim();
}

function extractCandidateName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/\s*resume$/i, "")
    .replace(
      /\s*-\s*(software engineer|frontend engineer|backend engineer|full stack developer|developer|engineer).*$/i,
      ""
    )
    .trim();
}

function formatResumeContent(resume: ResumeData): string {
  let content = `Candidate: ${resume.name}\n`;
  const pc = resume.parsedContent;
  const summary = extractSummary(pc.rawText);
  if (summary) content += `Summary: ${summary}\n`;
  if (pc.skills?.length) content += `Skills: ${pc.skills.slice(0, 20).join(", ")}\n`;
  if (pc.experience?.length) {
    content += "Experience:\n";
    for (const entry of pc.experience.slice(0, 4)) {
      content += `- ${entry.role} at ${entry.company} (${entry.startDate} - ${entry.endDate || "Present"}): ${entry.description}\n`;
    }
  }
  if (pc.projects?.length) {
    content += "Projects:\n";
    for (const project of pc.projects.slice(0, 2)) {
      content += `- ${project.name}: ${project.description}\n`;
    }
  }
  return content.trim();
}

function formatJobMetadata(jobMetadata?: JobMetadata): string {
  if (!jobMetadata) return "";
  return [
    jobMetadata.title ? `Title: ${jobMetadata.title}` : "",
    jobMetadata.company ? `Company: ${jobMetadata.company}` : "",
    jobMetadata.location ? `Location: ${jobMetadata.location}` : "",
    jobMetadata.aboutCompany ? `About company: ${jobMetadata.aboutCompany}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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
  const jobMetadata = body.jobMetadata as JobMetadata | undefined;

  if (!resumeData || !jdData?.content?.trim()) {
    return new Response(JSON.stringify({ error: "Resume and job description are required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const candidateName = extractCandidateName(resumeData.name);
  const resumeContent = formatResumeContent(resumeData);
  const jobSummary = formatJobMetadata(jobMetadata);
  const jobDescription = jdData.content!.trim().replace(/\s+/g, " ");

  const userPrompt = [
    `CANDIDATE NAME: ${candidateName}`,
    jobSummary ? `JOB METADATA:\n${jobSummary}` : "",
    `PARSED RESUME:\n${resumeContent}`,
    `JOB DESCRIPTION:\n${jobDescription.slice(0, 6000)}`,
    `TASK:\nWrite a tailored cover letter for this application.\n- Keep it honest and grounded in the resume.\n- Prefer specific, verifiable details from the resume (projects, responsibilities, scope). Do not add new facts.\n- If the role is more senior than the resume, acknowledge it subtly through tone (do not claim seniority).\n- Avoid generic lines like "cutting-edge", "excited", "perfect fit", "I am confident".\n- Ensure every paragraph reads naturally with correct grammar.\n- Output only the final cover letter.`,
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
    temperature: 0.35,
    topP: 0.9,
    maxTokens: 700,
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
