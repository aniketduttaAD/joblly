import { NextRequest, NextResponse } from "next/server";
import { handleCors } from "@/lib/server/cors";
import { createAiChatSseStream } from "@/lib/server/ai-completion";
import { GEMINI_SIDE_MODEL, OPENAI_SIDE_MODEL } from "@/lib/server/ai-models";
import { resolveAiCredentials } from "@/lib/server/resolve-ai-credentials";

export const runtime = "nodejs";

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
      achievements?: string[];
    }>;
    projects?: Array<{
      name: string;
      description: string;
      technologies?: string[];
      duration?: string;
    }>;
    education?: Array<{
      degree: string;
      field?: string;
      institution: string;
      graduationDate?: string;
    }>;
  };
}

interface JobData {
  content?: string;
  extracted?: {
    roleTitle?: string;
    company?: string;
    requiredSkills?: string[];
    preferredSkills?: string[];
    responsibilities?: string[];
  };
}

function formatResumeContent(resume: ResumeData): string {
  let content = `RESUME: ${resume.name}\n\n`;
  const parsed = resume.parsedContent;
  if (parsed.skills?.length) content += `SKILLS: ${parsed.skills.join(", ")}\n\n`;
  if (parsed.experience?.length) {
    content += "EXPERIENCE:\n";
    for (const item of parsed.experience) {
      content += `- ${item.role} at ${item.company} (${item.startDate} - ${item.endDate || "Present"})\n  ${item.description}\n`;
      if (item.achievements?.length) content += `  Achievements: ${item.achievements.join("; ")}\n`;
    }
    content += "\n";
  }
  if (parsed.projects?.length) {
    content += "PROJECTS:\n";
    for (const project of parsed.projects) {
      content += `- ${project.name}`;
      if (project.duration) content += ` (${project.duration})`;
      content += `\n  ${project.description}\n`;
      if (project.technologies?.length)
        content += `  Technologies: ${project.technologies.join(", ")}\n`;
    }
    content += "\n";
  }
  if (parsed.education?.length) {
    content += "EDUCATION:\n";
    for (const item of parsed.education) {
      content += `- ${item.degree}`;
      if (item.field) content += ` | ${item.field}`;
      content += ` | ${item.institution}`;
      if (item.graduationDate) content += ` | ${item.graduationDate}`;
      content += "\n";
    }
  }
  return content.trim();
}

function buildPrompt(jobMetadata?: Record<string, unknown>) {
  const title = String(jobMetadata?.title || "");
  const company = String(jobMetadata?.company || "");
  return `You are an ATS resume optimization assistant.

Your task:
1. Read the original parsed resume and the full job description.
2. Identify the most important role-specific keywords and phrases from the JD.
3. Compare them with the resume and identify missing but relevant keywords.
4. Rewrite the resume content to improve ATS alignment while staying truthful.
5. Keep the candidate's original structure: Summary, Skills, Experience, Projects, Education.
6. Do not invent experience, numbers, certifications, companies, or tools that are not supported by the resume.
7. Keep it concise, professional, and optimized for ATS scanning.

Target role: ${title || "Not provided"}
Target company: ${company || "Not provided"}

Output format:
- A clean ATS-optimized resume in plain text
- Preserve section headers
- Use bullet points where helpful
- Include a short "Missing Keywords Added" section at the end listing only relevant keywords you incorporated

Strict rules:
- No fabricated experience
- No markdown code fences
- No commentary before or after the resume
- Keep the resume ready for download as a document`;
}

export async function OPTIONS(req: NextRequest) {
  return handleCors(req) ?? new NextResponse(null, { status: 204 });
}

export async function POST(req: NextRequest) {
  const cors = handleCors(req);

  const creds = resolveAiCredentials(req);
  if (!creds.ok) {
    return new Response(JSON.stringify({ error: creds.error }), {
      status: creds.status,
      headers: cors?.headers ? { ...cors.headers, "Content-Type": "application/json" } : undefined,
    });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: cors?.headers ? { ...cors.headers, "Content-Type": "application/json" } : undefined,
    });
  }

  const resumeData = body.resumeData as ResumeData | undefined;
  const jdData = body.jdData as JobData | undefined;
  const jobMetadata = body.jobMetadata as Record<string, unknown> | undefined;

  if (!resumeData?.parsedContent) {
    return new Response(
      JSON.stringify({
        error: "Unable to generate resume improvements. Please upload a valid resume.",
      }),
      {
        status: 400,
        headers: cors?.headers
          ? { ...cors.headers, "Content-Type": "application/json" }
          : undefined,
      }
    );
  }

  const jdText = jdData?.content?.trim() || "";
  if (!jdText) {
    return new Response(
      JSON.stringify({ error: "Job description is required to generate an ATS resume." }),
      {
        status: 400,
        headers: cors?.headers
          ? { ...cors.headers, "Content-Type": "application/json" }
          : undefined,
      }
    );
  }

  const resumeContent = formatResumeContent(resumeData);
  const extracted = jdData?.extracted;
  const jdContext = [
    jdText,
    extracted?.requiredSkills?.length
      ? `Required skills: ${extracted.requiredSkills.join(", ")}`
      : "",
    extracted?.preferredSkills?.length
      ? `Preferred skills: ${extracted.preferredSkills.join(", ")}`
      : "",
    extracted?.responsibilities?.length
      ? `Responsibilities: ${extracted.responsibilities.join("; ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const model = creds.provider === "openai" ? OPENAI_SIDE_MODEL : GEMINI_SIDE_MODEL;
  const stream = createAiChatSseStream(creds.provider, creds.apiKey, {
    model,
    messages: [
      { role: "system", content: buildPrompt(jobMetadata) },
      {
        role: "user",
        content: `ORIGINAL RESUME\n\n${resumeContent}\n\nJOB DESCRIPTION\n\n${jdContext}`,
      },
    ],
    temperature: 0.5,
    topP: 0.9,
    maxTokens: 4096,
  });

  return new Response(stream, {
    headers: cors?.headers
      ? {
          ...(cors?.headers ?? {}),
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        }
      : undefined,
  });
}
