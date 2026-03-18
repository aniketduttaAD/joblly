import { NextRequest } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";

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

  const apiKey = (process.env.OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: "OpenAI API key is not configured on the server." }),
      {
        status: 500,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
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

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (value: string) => new TextEncoder().encode(value);
      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: buildSystemPrompt() },
              { role: "user", content: userPrompt },
            ],
            temperature: 0.15,
            top_p: 0.9,
            max_tokens: 420,
            stream: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(errorText || "Failed to analyze resume gaps");
        }
        if (!response.body) throw new Error("No response stream from OpenAI");

        const reader = response.body.getReader();
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
              if (content) controller.enqueue(encode(`data: ${JSON.stringify({ content })}\n\n`));
            } catch {
              continue;
            }
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
      ...cors,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
