import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, errorResponse, corsHeaders } from "../_shared/cors.ts";

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

  if (parsed.skills?.length) {
    content += `SKILLS: ${parsed.skills.join(", ")}\n\n`;
  }
  if (parsed.experience?.length) {
    content += "EXPERIENCE:\n";
    for (const item of parsed.experience) {
      content += `- ${item.role} at ${item.company} (${item.startDate} - ${item.endDate || "Present"})\n`;
      content += `  ${item.description}\n`;
      if (item.achievements?.length) {
        content += `  Achievements: ${item.achievements.join("; ")}\n`;
      }
    }
    content += "\n";
  }
  if (parsed.projects?.length) {
    content += "PROJECTS:\n";
    for (const project of parsed.projects) {
      content += `- ${project.name}`;
      if (project.duration) content += ` (${project.duration})`;
      content += `\n  ${project.description}\n`;
      if (project.technologies?.length) {
        content += `  Technologies: ${project.technologies.join(", ")}\n`;
      }
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

function buildPrompt(jobMetadata: Record<string, unknown> | undefined) {
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

  const resumeData = body.resumeData as ResumeData | undefined;
  const jdData = body.jdData as JobData | undefined;
  const jobMetadata = body.jobMetadata as Record<string, unknown> | undefined;

  if (!resumeData?.parsedContent) {
    return errorResponse(
      "Unable to generate resume improvements. Please upload a valid resume.",
      400
    );
  }

  const jdText = jdData?.content?.trim() || "";
  if (!jdText) {
    return errorResponse("Job description is required to generate an ATS resume.", 400);
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

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);

      try {
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "gpt-3.5-turbo",
            stream: true,
            temperature: 0.5,
            messages: [
              { role: "system", content: buildPrompt(jobMetadata) },
              {
                role: "user",
                content: `ORIGINAL RESUME\n\n${resumeContent}\n\nJOB DESCRIPTION\n\n${jdContext}`,
              },
            ],
          }),
        });

        if (!response.ok || !response.body) {
          throw new Error("Failed to generate ATS resume.");
        }

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
              if (content) {
                controller.enqueue(encode(`data: ${JSON.stringify({ content })}\n\n`));
              }
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
      ...corsHeaders,
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});
