import { NextRequest } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";

export const runtime = "nodejs";

const MAX_TOKENS_PER_REQUEST = 15_000;

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  sept: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

type QuestionMode = "fit" | "gaps" | "interview" | "skills" | "general";
type QuestionProfile = {
  mode: QuestionMode;
  completionTokens: number;
  historyMessageLimit: number;
  includeFullJD: boolean;
};

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function buildSystemPrompt(): string {
  return `You are a job-fit assistant. You ONLY answer questions about:
- The candidate's resume and background
- The specific job posting provided
- Job fit, eligibility, or match analysis
- Interview preparation for this role
- Required or preferred skills for this role
- Resume gaps or missing experience for this role
- Responsibilities, compensation, or context for this specific role

Off-domain rule (highest priority):
If the user asks about ANYTHING outside the list above — including general knowledge, coding help unrelated to their background, current events, recipes, personal advice, entertainment, math problems, or any other topic — respond with exactly this sentence and nothing else:
"I can only help with questions about this job, your resume, interview prep, or your fit for this role."
Do not attempt to answer off-domain questions even partially. Do not apologise at length. Just return that one sentence.

Non-negotiable rules:
1. Never invent skills, achievements, years of experience, employers, education, locations, dates, or responsibilities.
2. Never exaggerate fit. Use the exact years or months stated in the provided facts.
3. Never imply the candidate has a skill unless it appears in the provided data.
4. If evidence is missing or weak, say it is missing or unclear.
5. Write in plain, professional language. No hype, no flattery, no placeholder text.
6. Keep answers concise but useful.
7. Never round 1.5 years up to 15 years. Preserve decimals exactly as provided.
8. If a fact block says "Candidate experience: 1.5+ years", repeat "1.5+ years" exactly.
9. Proofread before answering: correct grammar, spacing, and punctuation. Avoid typos.
10. When you cite a requirement (tool/skill/years), use only phrases explicitly present in the JD context we provide. Do not guess or paraphrase into new proper nouns.
11. Never truncate or abbreviate section headings. Write every heading in full exactly as instructed (e.g. "What to emphasize anyway:" never "What to anyway:").
12. Never end a sentence or bullet point mid-word or mid-thought. Every sentence must be complete.

For gap-analysis questions such as missing skills, fit, match, eligibility, strengths, weaknesses, or resume gaps:
- Start with the main mismatch first.
- Be candid about seniority gaps, domain gaps, and missing tools.
- Separate "Strong matches" from "Gaps or concerns".
- Mention what the candidate can still emphasize honestly.
- If the role is clearly more senior than the resume, say "not a strong fit right now" or similar plain language.
- Give a one-line verdict first.
- Prefer factual bullets over persuasive language.

For interview-style or general questions:
- Answer in first person as the candidate.
- Stay factual and grounded in the resume.

Avoid vague claims like "aligns perfectly", "strong fit" unless directly supported, "adapting will not be an issue", "I led" unless leadership evidence is explicit.

If the user asks for missing skills or resume gaps, do not sell the profile. Audit it honestly.`;
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

interface JDData {
  content?: string;
  extracted?: {
    roleTitle?: string;
    company?: string;
    requiredSkills?: string[];
    preferredSkills?: string[];
    responsibilities?: string[];
  };
}

type InferredRequirements = {
  roleTitle: string;
  requiredYears: string;
  requiredSkills: string[];
  testingRequirements: string[];
  leadershipSignals: string[];
  responsibilityHighlights: string[];
  keywordSet: Set<string>;
};

function analyzeQuestion(question: string): QuestionProfile {
  const normalized = question.toLowerCase();
  if (/(good fit|fit for|am i fit|match|eligible|right for this role)/.test(normalized))
    return { mode: "fit", completionTokens: 560, historyMessageLimit: 4, includeFullJD: false };
  if (/(missing skills|gaps|what am i missing|missing data)/.test(normalized))
    return { mode: "gaps", completionTokens: 560, historyMessageLimit: 4, includeFullJD: false };
  if (
    /(interview|answer|tell me about yourself|introduce yourself|why should|why do you)/.test(
      normalized
    )
  )
    return {
      mode: "interview",
      completionTokens: 650,
      historyMessageLimit: 6,
      includeFullJD: true,
    };
  if (/(skills|tech stack|technologies|tools)/.test(normalized))
    return { mode: "skills", completionTokens: 380, historyMessageLimit: 4, includeFullJD: false };
  return { mode: "general", completionTokens: 500, historyMessageLimit: 5, includeFullJD: true };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function inferRequirementsFromJD(jdText: string): InferredRequirements {
  const normalized = jdText.replace(/\s+/g, " ").trim();
  const lines = normalized
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const roleTitle = lines[0] || "";
  const yearsMatch =
    normalized.match(/(\d+\+?\s+years?)\s+of\s+experience/i) ||
    normalized.match(/(\d+\+?\s+years?)/i);
  const catalog = [
    "React",
    "Next.js",
    "JavaScript",
    "TypeScript",
    "Jest",
    "React Testing Library",
    "Enzyme",
    "GitLab",
    "AWS",
    "CI/CD",
    "API design",
    "accessibility",
    "performance",
    "scalability",
    "Elixir",
    "Phoenix",
    "Postgres",
    "English",
  ];
  const requiredSkills = catalog.filter((skill) =>
    new RegExp(`\\b${escapeRegExp(skill).replace(/\\ /g, "\\s+")}\\b`, "i").test(normalized)
  );
  const testingRequirements = requiredSkills.filter((skill) =>
    /jest|testing library|enzyme/i.test(skill)
  );
  const leadershipSignals = [
    "lead the development of major projects",
    "maintain large front-end applications",
    "mentor other engineers",
    "work independently",
  ].filter((signal) => normalized.includes(signal.replace(/-/g, " ")));
  const responsibilityHighlights = [
    "building tools, APIs and integrations",
    "provide meaningful feedback on code reviews",
    "mentor and provide guidance to other engineers",
    "implement interfaces with quality",
    "participate in product work",
  ].filter((item) => normalized.includes(item));
  return {
    roleTitle,
    requiredYears: yearsMatch?.[1] ?? "",
    requiredSkills,
    testingRequirements,
    leadershipSignals,
    responsibilityHighlights,
    keywordSet: new Set(requiredSkills.map((s) => s.toLowerCase())),
  };
}

function extractSummary(rawText?: string): string {
  if (!rawText) return "";
  const normalized = rawText.replace(/\s+/g, " ").trim();
  const match =
    normalized.match(
      /summary\s+(.+?)(?:technical skills|core competencies|work experience|experience|projects|education)/i
    ) ||
    normalized.match(
      /professional summary\s+(.+?)(?:technical skills|core competencies|work experience|experience|projects|education)/i
    );
  return match?.[1] ? match[1].trim() : normalized.slice(0, 320).trim();
}

function parseMonthYear(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed || /present|current/i.test(trimmed)) return null;
  const match = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!match) return null;
  const month = MONTH_INDEX[match[1].toLowerCase()];
  const year = Number(match[2]);
  if (month === undefined || Number.isNaN(year)) return null;
  return new Date(year, month, 1);
}

function estimateExperienceMonths(entries: Array<{ startDate: string; endDate?: string }>): number {
  let totalMonths = 0;
  for (const entry of entries) {
    const start = parseMonthYear(entry.startDate);
    const end = parseMonthYear(entry.endDate || "") ?? new Date();
    if (!start || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start)
      continue;
    totalMonths += Math.max(
      0,
      (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1
    );
  }
  return totalMonths;
}

function summarizeExperience(resume: ResumeData): string {
  const rawText = resume.parsedContent.rawText;
  const explicitMatch = rawText?.match(/(\d+(?:\.\d+)?)\+?\s*years?\s+of\s+experience/i);
  if (explicitMatch?.[1]) {
    const hasPlus = /\+\s*years?\s+of\s+experience/i.test(explicitMatch[0]);
    return `Candidate experience: ${explicitMatch[1]}${hasPlus ? "+" : ""} years. This value is exact from the resume summary.`;
  }
  const months = estimateExperienceMonths(resume.parsedContent.experience ?? []);
  if (months > 0)
    return `Candidate experience estimate from dated roles: ${(months / 12).toFixed(1)} years (${months} months).`;
  return "Total years of experience are not clearly stated in the provided resume data.";
}

function scoreText(text: string, reqs: InferredRequirements, question: string) {
  const lower = text.toLowerCase();
  let score = 0;
  for (const kw of reqs.keywordSet) {
    if (lower.includes(kw)) score += 3;
  }
  if (/react|next\.js|frontend|web/.test(lower)) score += 2;
  if (/lead|owner|mentor|architect/.test(lower)) score += 2;
  for (const token of question.split(/\W+/).filter(Boolean)) {
    if (token.length > 3 && lower.includes(token)) score += 1;
  }
  return score;
}

function formatResumeContent(
  resume: ResumeData,
  options: {
    question: string;
    profile: QuestionProfile;
    retrievedSections?: string[];
    inferredRequirements: InferredRequirements;
  }
): string {
  const { retrievedSections, inferredRequirements, question } = options;
  if (retrievedSections?.length)
    return `RESUME: ${resume.name}\n\nRELEVANT SECTIONS:\n\n${retrievedSections.map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`;

  let content = `RESUME: ${resume.name}\n\n`;
  const pc = resume.parsedContent;
  const summary = extractSummary(pc.rawText);
  const q = question.toLowerCase();

  const matchedSkills = (pc.skills ?? [])
    .filter((skill) => {
      const lower = skill.toLowerCase();
      return (
        inferredRequirements.keywordSet.has(lower) ||
        q.includes(lower) ||
        (/front|web|ui/.test(q) && /react|next|javascript|typescript|css|html/.test(lower)) ||
        (/test/.test(q) && /jest|testing|postman/.test(lower))
      );
    })
    .slice(0, 16);

  const relevantExp = [...(pc.experience ?? [])]
    .map((e) => ({
      e,
      score: scoreText(`${e.role} ${e.company} ${e.description}`, inferredRequirements, q),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((x) => x.e);
  const relevantProj = [...(pc.projects ?? [])]
    .map((p) => ({ p, score: scoreText(`${p.name} ${p.description}`, inferredRequirements, q) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map((x) => x.p);

  if (summary) content += `SUMMARY: ${summary}\n\n`;
  if (matchedSkills.length) content += `MOST RELEVANT SKILLS: ${matchedSkills.join(", ")}\n\n`;
  else if (pc.skills?.length) content += `SKILLS: ${pc.skills.slice(0, 20).join(", ")}\n\n`;
  if (relevantExp.length) {
    content += `MOST RELEVANT EXPERIENCE:\n`;
    for (const e of relevantExp)
      content += `- ${e.role} at ${e.company} (${e.startDate} - ${e.endDate || "Present"})\n  ${e.description}\n`;
    content += "\n";
  }
  if (relevantProj.length) {
    content += `RELEVANT PROJECTS:\n`;
    for (const p of relevantProj) content += `- ${p.name}: ${p.description}\n`;
    content += "\n";
  }
  if (pc.education?.length) {
    content += `EDUCATION:\n`;
    for (const e of pc.education)
      content += `- ${e.degree}${e.field ? ` in ${e.field}` : ""} from ${e.institution}\n`;
  }
  return content;
}

function formatJobMetadata(jdData: JDData): string {
  const extracted = jdData.extracted ?? {};
  const lines = [
    `Role title: ${extracted.roleTitle || "Unknown"}`,
    `Company: ${extracted.company || "Unknown"}`,
  ];
  if (extracted.requiredSkills?.length)
    lines.push(`Required skills: ${extracted.requiredSkills.join(", ")}`);
  if (extracted.preferredSkills?.length)
    lines.push(`Preferred skills: ${extracted.preferredSkills.join(", ")}`);
  if (extracted.responsibilities?.length)
    lines.push(`Responsibilities: ${extracted.responsibilities.join(" | ")}`);
  return lines.join("\n");
}

function trimChatHistory(
  history: Array<{ role: string; content: string }>,
  profile: QuestionProfile
) {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-(profile.historyMessageLimit * 2))
    .map((m) => ({
      ...m,
      content: m.content.length > 1200 ? `${m.content.slice(0, 1200)}\n[truncated]` : m.content,
    }));
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
    return new Response(JSON.stringify({ error: "Resume and JD data are required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
  if (!question || typeof question !== "string") {
    return new Response(JSON.stringify({ error: "Question is required" }), {
      status: 400,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  const normalizedResume = resumeData as ResumeData;
  const normalizedJD = jdData as JDData;
  const questionProfile = analyzeQuestion(question);
  const inferredRequirements = inferRequirementsFromJD(normalizedJD.content ?? "");
  const experienceSummary = summarizeExperience(normalizedResume);

  const resumeContent = formatResumeContent(normalizedResume, {
    question,
    profile: questionProfile,
    retrievedSections: retrievedResumeSections as string[] | undefined,
    inferredRequirements,
  });

  const jdContent =
    Array.isArray(retrievedJDSections) && (retrievedJDSections as string[]).length > 0
      ? `RELEVANT SECTIONS:\n\n${(retrievedJDSections as string[]).map((s, i) => `${i + 1}. ${s}`).join("\n\n")}`
      : (() => {
          const fullText = (normalizedJD.content ?? "").replace(/\s+/g, " ").trim();
          const sections = [
            inferredRequirements.roleTitle ? `ROLE TITLE: ${inferredRequirements.roleTitle}` : "",
            inferredRequirements.requiredYears
              ? `REQUIRED EXPERIENCE: ${inferredRequirements.requiredYears}`
              : "",
            inferredRequirements.requiredSkills.length
              ? `KEY REQUIRED SKILLS: ${inferredRequirements.requiredSkills.join(", ")}`
              : "",
            inferredRequirements.testingRequirements.length
              ? `TESTING REQUIREMENTS: ${inferredRequirements.testingRequirements.join(", ")}`
              : "",
            inferredRequirements.leadershipSignals.length
              ? `LEADERSHIP EXPECTATIONS: ${inferredRequirements.leadershipSignals.join(", ")}`
              : "",
            inferredRequirements.responsibilityHighlights.length
              ? `RESPONSIBILITIES: ${inferredRequirements.responsibilityHighlights.join(" | ")}`
              : "",
            questionProfile.includeFullJD ? `FULL JD (TRUNCATED): ${fullText.slice(0, 4000)}` : "",
          ].filter(Boolean);
          return sections.join("\n\n");
        })();

  const jobMetadata = formatJobMetadata(normalizedJD);
  const hasReact = (normalizedResume.parsedContent.skills ?? []).some((s) => /react/i.test(s));
  const hasNext = (normalizedResume.parsedContent.skills ?? []).some((s) => /next\.?js/i.test(s));
  const hasJs = (normalizedResume.parsedContent.skills ?? []).some((s) => /javascript/i.test(s));
  const allText = [
    ...(normalizedResume.parsedContent.experience ?? []).map((e) => e.description),
    ...(normalizedResume.parsedContent.projects ?? []).map((p) => p.description),
    normalizedResume.parsedContent.rawText ?? "",
  ]
    .join(" ")
    .toLowerCase();
  const hasLeadership =
    /\b(lead|led|leading|mentor|mentored|managed|owner|owned|ownership|architected)\b/.test(
      allText
    );

  const fitFacts = [
    `Target role title: ${inferredRequirements.roleTitle || "Unknown"}`,
    `Role seniority cue: ${inferredRequirements.roleTitle.toLowerCase().includes("senior") ? "senior" : "not clearly senior"}`,
    inferredRequirements.requiredYears
      ? `JD required experience: ${inferredRequirements.requiredYears}`
      : "JD required experience: not clearly stated",
    experienceSummary,
    `Candidate has React: ${hasReact ? "yes" : "no"}`,
    `Candidate has Next.js: ${hasNext ? "yes" : "no"}`,
    `Candidate has JavaScript: ${hasJs ? "yes" : "no"}`,
    `Candidate has explicit leadership evidence: ${hasLeadership ? "yes" : "no"}`,
    inferredRequirements.requiredSkills.length
      ? `JD required skills: ${inferredRequirements.requiredSkills.join(", ")}`
      : "",
    "Important instruction: do not change numeric values from the facts above.",
  ]
    .filter(Boolean)
    .join("\n");

  const jdQuotedFacts = [
    inferredRequirements.requiredYears
      ? `JD says required experience: "${inferredRequirements.requiredYears}"`
      : "",
    inferredRequirements.requiredSkills.length
      ? `JD explicitly mentions skills/tools: ${inferredRequirements.requiredSkills
          .slice(0, 24)
          .map((s) => `"${s}"`)
          .join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const contextPrompt = `JOB METADATA:\n${jobMetadata}\n\nNORMALIZED FACTS:\n${fitFacts}\n\nJD QUOTED FACTS (use these exact phrases; do not invent new requirement names):\n${jdQuotedFacts || "—"}\n\nRESUME CONTENT:\n${resumeContent}\n\nJOB DESCRIPTION:\n${jdContent}\n\nEXPERIENCE SUMMARY:\n${experienceSummary}\n\nUse ONLY the evidence above. Be explicit about gaps, especially years-of-experience mismatches, missing tools, and missing leadership evidence.\n\nWhen answering, always use clear paragraphs and bullets with blank lines between sections.\n\nIf the question is about fit/match/eligibility, you MUST use exactly this structure:\n\nVerdict: <one plain conclusion sentence on the same line as the heading>\n\nStrong matches:\n- <bullet 1>\n\nGaps or concerns:\n- <bullet 1>\n\nWhat to emphasize anyway:\n- <bullet 1>\n\nFormatting rules:\n- The Verdict line must be: "Verdict: " followed immediately by the conclusion sentence — no bullet, no newline between them.\n- Each bullet under the other sections must be a complete, grammatically correct sentence — never end a bullet mid-word or mid-thought.\n- Use the exact section headings as written above (e.g. "Strong matches:" not "Strong matches-", "What to emphasize anyway:" in full — never abbreviate or shorten headings).\n- Do not include extra headings or sections.\n- Do not output markdown code fences.\n- Write every heading with a colon after it, never a hyphen.`;

  const userPrompt = `QUESTION:\n${question}${extraInstructions ? `\n\nEXTRA INSTRUCTIONS (follow, but do not break formatting rules):\n${extraInstructions}` : ""}`;

  const baseMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "user", content: contextPrompt },
  ];

  if (Array.isArray(chatHistory)) {
    const trimmed = trimChatHistory(
      chatHistory as Array<{ role: string; content: string }>,
      questionProfile
    );
    for (const msg of trimmed) {
      if (msg.role === "user" || msg.role === "assistant")
        baseMessages.push({ role: msg.role as "user" | "assistant", content: msg.content });
    }
  }

  baseMessages.push({ role: "user", content: userPrompt });

  const allTextForTokenCheck = buildSystemPrompt() + baseMessages.map((m) => m.content).join("\n");
  if (estimateTokens(allTextForTokenCheck) > MAX_TOKENS_PER_REQUEST) {
    return new Response(
      JSON.stringify({ error: "Request too large. Please shorten the resume or job description." }),
      {
        status: 429,
        headers: { ...cors, "Content-Type": "application/json" },
      }
    );
  }

  const stream = new ReadableStream({
    async start(controller) {
      const encode = (s: string) => new TextEncoder().encode(s);
      try {
        const aiRes = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: "gpt-4o",
            messages: [{ role: "system", content: buildSystemPrompt() }, ...baseMessages],
            temperature: 0.25,
            top_p: 0.9,
            frequency_penalty: 0.2,
            presence_penalty: 0,
            max_tokens: questionProfile.completionTokens,
            stream: true,
          }),
        });

        if (!aiRes.ok) {
          const errorText = await aiRes.text().catch(() => "");
          throw new Error(errorText || "Failed to generate chat response");
        }
        if (!aiRes.body) throw new Error("No response stream from OpenAI");

        const reader = aiRes.body.getReader();
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
              /* skip malformed chunk */
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
