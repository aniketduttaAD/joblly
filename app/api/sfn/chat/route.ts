import { NextRequest } from "next/server";
import { corsHeaders, handlePreflight } from "@/lib/server/cors";
import { createAiChatSseStream } from "@/lib/server/ai-completion";
import { GEMINI_CHAT_MODEL, OPENAI_CHAT_MODEL } from "@/lib/server/ai-models";
import { resolveAiCredentials } from "@/lib/server/resolve-ai-credentials";

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

type QuestionMode =
  | "fit"
  | "gaps"
  | "cover_letter"
  | "linkedin"
  | "email"
  | "interview"
  | "salary"
  | "skills"
  | "general";

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
- Job fit, eligibility, or match analysis (including "am I a good fit", "should I apply", "strong candidate")
- Interview preparation for this role
- Required or preferred skills for this role
- Resume gaps or missing experience for this role ("what is missing", "what am I lacking", gaps vs JD)
- Drafting a cover letter or application letter for this specific role
- Drafting a LinkedIn message, connection note, or InMail to a hiring manager or recruiter for this role
- Drafting a professional email to a hiring manager or recruiter for this role
- Responsibilities, compensation, or context for this specific role
- Salary range, pay band, CTC/LPA, equity or bonus **when discussed in relation to this job posting** — including what the posting states, what is missing, and how to interpret ranges honestly (separate facts from estimates)

Off-domain rule (highest priority):
If the user asks about ANYTHING outside the list above — including general knowledge, coding help unrelated to their background, current events, recipes, personal advice, entertainment, math problems, or any other topic — reply with exactly this (two short sentences, nothing before or after):
"I'm not able to help with that. I can assist only with this role, your resume, interview preparation, or how your background compares to the job posting."
Do not answer off-domain questions even partially. Do not add apologies, explanations, or alternatives.

Voice and tone (on-domain answers):
- Use a professional, formal tone that still reads like a clear human wrote it: direct sentences, natural word order, no filler ("Certainly!", "I'd be happy to", "Great question").
- Be precise and grounded: tie conclusions to specific resume or JD details; avoid vague stock phrases repeated across answers.
- Sound confident but measured — not robotic, not salesy. Vary openings when appropriate instead of repeating the same template every time.
- Every answer must be grammatically complete, with correct subject–verb agreement and full clauses (no trailing fragments like "which are not mentioned in your.").

Non-negotiable rules:
1. Never invent skills, achievements, years of experience, employers, education, locations, dates, or responsibilities.
2. Never exaggerate fit. Use the exact years or months stated in the provided facts.
3. Never imply the candidate has a skill unless it appears in the provided data.
4. If evidence is missing or weak, say it is missing or unclear.
5. Write in plain, professional language. No hype, no flattery, no placeholder text.
6. Keep answers concise but useful — include enough context that each point stands alone as a full thought.
7. Never round 1.5 years up to 15 years. Preserve decimals exactly as provided.
8. If a fact block says "Candidate experience: 1.5+ years", repeat "1.5+ years" exactly.
9. Proofread before answering: correct grammar, spacing, and punctuation. Avoid typos.
10. When you cite a requirement (tool/skill/years), use only phrases explicitly present in the JD context we provide. Do not guess or paraphrase into new proper nouns.
11. Never truncate or abbreviate section headings. Write every heading in full exactly as instructed (e.g. "What to emphasize anyway:" never "What to anyway:").
12. Never end a sentence or bullet point mid-word or mid-thought. Every sentence must be complete.

For salary, compensation, or pay-range questions:
- Lead with what the **job description or structured salary fields** actually say (quote or paraphrase closely; include currency and time period if given).
- If the posting does **not** state numbers, say so plainly before any general discussion.
- You may add **clearly labeled** general-market context (typical bands by role seniority and location) only as rough orientation — not as fact about this employer — and avoid narrow fake precision.
- Never invent a specific salary, bonus, or equity figure not supported by the provided JD or metadata.
- If the candidate asks what they should ask for or counter-offer, ground advice in their resume seniority and the JD’s stated level; stay conservative when data is thin.

For fit and gap-analysis (missing skills, what is lacking, good fit, eligibility):
- Start with the main mismatch first.
- Be candid about seniority gaps, domain gaps, and missing tools.
- Separate "Strong matches" from "Gaps or concerns".
- Mention what the candidate can still emphasize honestly.
- If the role is clearly more senior than the resume, say "not a strong fit right now" or similar plain language.
- Give a one-line verdict first.
- Prefer factual bullets over persuasive language.

For cover letters, LinkedIn messages, and emails:
- Write in first person as the candidate. Tone: professional, warm, and specific—not generic or robotic.
- Tie content to this JD and this resume only; do not invent employers, metrics, or skills.
- Use company and role names from JOB METADATA when present; otherwise use neutral wording without fake names.
- LinkedIn and email should be concise; cover letters can be fuller but still tight (no filler paragraphs).

For interview-style or other general questions:
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
    location?: string;
    requiredSkills?: string[];
    preferredSkills?: string[];
    responsibilities?: string[];
    salaryMin?: number | null;
    salaryMax?: number | null;
    salaryCurrency?: string | null;
    salaryPeriod?: string | null;
    salaryEstimated?: boolean;
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

/** Detects intent so the model gets the right structure, token budget, and JD depth. Order matters: more specific patterns first. */
function analyzeQuestion(question: string): QuestionProfile {
  const normalized = question.toLowerCase();

  if (
    /(cover letter|cover-letter|letter of application|application letter|write (me )?a cover|draft (a )?cover|help (me )?with (my )?cover|cover for this)/.test(
      normalized
    )
  ) {
    return {
      mode: "cover_letter",
      completionTokens: 900,
      historyMessageLimit: 4,
      includeFullJD: true,
    };
  }

  if (
    /(cold email|email (to|for) (the )?(hiring|recruiter)|outreach email|write (me )?an email|email (subject|template)|subject line|e-mail (to|for))/.test(
      normalized
    )
  ) {
    return {
      mode: "email",
      completionTokens: 750,
      historyMessageLimit: 4,
      includeFullJD: true,
    };
  }

  if (
    /(linkedin|connection request|inmail|in-mail|message (on|for|via) linkedin|linkedin (message|note|dm|post))/.test(
      normalized
    )
  ) {
    return {
      mode: "linkedin",
      completionTokens: 650,
      historyMessageLimit: 4,
      includeFullJD: true,
    };
  }

  if (
    /(message to (the )?(hiring manager|recruiter)|note to (the )?recruiter|dm (the )?recruiter|reach out to (the )?(hiring manager|recruiter)|short message to)/.test(
      normalized
    ) &&
    !/email|e-mail/.test(normalized)
  ) {
    return {
      mode: "linkedin",
      completionTokens: 650,
      historyMessageLimit: 4,
      includeFullJD: true,
    };
  }

  if (
    /(good fit|bad fit|am i (a )?fit|fit for|fit for this|a match|eligible|right for (this|the) role|should i apply|worth applying|qualify|qualified|suitable|strong candidate|strong fit|weak fit|do i fit|how (well )?do i fit|will i get|chances of|am i right for|good candidate|decent fit)/.test(
      normalized
    )
  ) {
    return { mode: "fit", completionTokens: 560, historyMessageLimit: 4, includeFullJD: false };
  }

  if (
    /(missing skills|resume gap|gap(s)?\b|what am i missing|missing data|what is missing|what('s| is) (missing|lacking)|what do i lack|what am i lacking|weakness|weak areas|not enough experience|under-?qualified|areas to improve|what to improve|skills i lack|compare.*(resume|jd))/.test(
      normalized
    )
  ) {
    return { mode: "gaps", completionTokens: 560, historyMessageLimit: 4, includeFullJD: true };
  }

  if (
    /(salary|compensation|pay range|pay package|\bctc\b|\blpa\b|gross pay|base pay|take[- ]?home|hourly pay|annual pay|equity|rsu|bonus|how much (does|do|will) (this|the) (role|job|position) pay|expected pay|wage range|stipend|remuneration|package offered|pay scale)/.test(
      normalized
    )
  ) {
    return {
      mode: "salary",
      completionTokens: 780,
      historyMessageLimit: 5,
      includeFullJD: true,
    };
  }

  if (
    /(interview|answer|tell me about yourself|introduce yourself|why should|why do you)/.test(
      normalized
    )
  ) {
    return {
      mode: "interview",
      completionTokens: 650,
      historyMessageLimit: 6,
      includeFullJD: true,
    };
  }

  if (/(skills|tech stack|technologies|tools)/.test(normalized)) {
    return { mode: "skills", completionTokens: 420, historyMessageLimit: 4, includeFullJD: false };
  }

  return { mode: "general", completionTokens: 550, historyMessageLimit: 5, includeFullJD: true };
}

function buildResponseShapeInstructions(profile: QuestionProfile): string {
  const fitOrGapsBlock = `RESPONSE SHAPE FOR THIS QUESTION (follow exactly):

The user is asking about fit, match, eligibility, strengths vs gaps, "good fit", "should I apply", or what is missing / lacking. Use this structure:

Verdict: <one plain conclusion sentence on the same line as the heading>

Strong matches:
- <complete sentence 1>
- <add bullets as needed; each a full sentence>

Gaps or concerns:
- <complete sentence 1>
- <add bullets as needed>

What to emphasize anyway:
- <complete sentence 1>
- <add bullets as needed>

Rules: "Verdict: " must be immediately followed by the sentence (no bullet on that line). Every bullet is a complete sentence. Headings end with colons. No markdown code fences. Ground every point in the resume or JD text provided.`;

  const coverBlock = `RESPONSE SHAPE FOR THIS QUESTION (follow exactly):

The user wants a cover letter for this application. Write the full letter in first person.

Structure:
1) Opening: interest in this role at this company (use JOB METADATA company/role when present).
2) One or two body paragraphs: only achievements, tools, and experience that appear in the resume; connect them to requirements or themes from the JD.
3) Closing: brief, professional call to action.

Tone: professional and natural—specific, not generic or template-heavy. Do not invent employers, dates, or skills. Do not use bracket placeholders like [Company] when JOB METADATA or the JD gives a real name. Sign with the candidate's name from the resume if available. No meta-commentary before or after the letter. No markdown code fences.`;

  const linkedinBlock = `RESPONSE SHAPE FOR THIS QUESTION (follow exactly):

The user wants a LinkedIn-style message (connection note, InMail, or short DM to hiring manager/recruiter).

Length: about 4–8 short sentences unless they asked for longer. No bullet lists unless they explicitly asked.

Content: greet or open professionally (avoid stacking clichés), name the role and company from metadata/JD when known, one or two concrete lines grounded in the resume that relate to the JD, end with one polite low-pressure ask.

Tone: warm and professional, not robotic or salesy. Do not invent experience. No markdown code fences.`;

  const emailBlock = `RESPONSE SHAPE FOR THIS QUESTION (follow exactly):

The user wants an email to a hiring manager or recruiter.

Format:
Line 1: Subject: <concise, specific subject line>
(blank line)
Email body: greeting, 2–4 short paragraphs in first person, sign-off with the candidate's name if it appears on the resume.

Ground claims in the resume only. Natural business tone—not stiff, not chatty. No markdown code fences.`;

  const salaryBlock = `RESPONSE SHAPE FOR THIS QUESTION (follow exactly):

The user is asking about salary, pay, compensation, CTC/LPA, or similar for this role.

What the posting indicates:
- <one or more bullets; each a complete sentence. If the JD or structured fields give numbers, state them with currency and period (e.g. yearly). If nothing is stated, say so clearly here.>

What is not stated or is ambiguous:
- <complete sentences; say "not specified in the provided text" when applicable.>

Practical read for you (candidate):
- <2–4 short bullets: how to interpret what we know, what to verify in process, and how your resume level compares to the JD seniority cue — without inventing employer-specific numbers.>

Caveats:
- <one short bullet reminding that final offer depends on employer, geography, and negotiation; keep tone factual, not hype.>

Rules: No markdown code fences. Every bullet is a complete sentence. Do not fabricate numeric ranges not supported by the JD or structured salary fields; general-market bands must read as estimates, not facts about this company.`;

  const defaultBlock = `RESPONSE SHAPE FOR THIS QUESTION:

Answer directly in clear paragraphs (or short bullets if they help). Ground the answer in the resume and JD. Do NOT use the Verdict / Strong matches / Gaps structure unless the user is clearly asking for fit or gap analysis. Be complete: no sentence fragments or trailing cut-offs. No markdown code fences.`;

  switch (profile.mode) {
    case "fit":
    case "gaps":
      return fitOrGapsBlock;
    case "cover_letter":
      return coverBlock;
    case "linkedin":
      return linkedinBlock;
    case "email":
      return emailBlock;
    case "salary":
      return salaryBlock;
    default:
      return defaultBlock;
  }
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
  if (extracted.location?.trim()) lines.push(`Location: ${extracted.location.trim()}`);
  if (extracted.requiredSkills?.length)
    lines.push(`Required skills: ${extracted.requiredSkills.join(", ")}`);
  if (extracted.preferredSkills?.length)
    lines.push(`Preferred skills: ${extracted.preferredSkills.join(", ")}`);
  if (extracted.responsibilities?.length)
    lines.push(`Responsibilities: ${extracted.responsibilities.join(" | ")}`);
  const smin = extracted.salaryMin;
  const smax = extracted.salaryMax;
  if (smin != null || smax != null) {
    const cur = (extracted.salaryCurrency ?? "").trim() || "unspecified currency";
    const per = (extracted.salaryPeriod ?? "yearly").trim() || "yearly";
    const est = extracted.salaryEstimated ? " (estimated in job record)" : "";
    lines.push(
      `Structured salary (from job record): ${smin ?? "—"} to ${smax ?? "—"} ${cur}, period: ${per}${est}`
    );
  }
  return lines.join("\n");
}

function extractSalarySnippetsFromJd(jdText: string, maxSnippets = 6): string[] {
  const text = jdText.replace(/\s+/g, " ").trim();
  if (text.length < 15) return [];

  const patterns: RegExp[] = [
    /\$[\d,.]+\s*(?:-|–|to)\s*\$?[\d,.]+(?:\s*(?:k|K|USD|usd))?/g,
    /(?:₹|INR|USD|EUR|GBP)\s*[\d,.]+\s*(?:-|–|to|\/|\s)\s*[\d,.]*/gi,
    /\d[\d,]*\s*(?:-|–|to)\s*\d[\d,]*\s*(?:k|K|lpa|LPA|lakhs?|Lakhs?|crores?|Cr\.?)/gi,
    /(?:CTC|LPA|base salary|salary range|compensation package|pay range|gross (?:annual )?pay)\s*[:\-]?\s*[^\n.]{10,140}/gi,
    /(?:competitive|attractive|market(?:-|\s)rate)\s+(?:salary|compensation|package)[^\n.]{0,100}/gi,
    /(?:per hour|\/hr|hourly)\s*(?:rate|pay)?\s*[:\-]?\s*[^\n.]{5,80}/gi,
  ];

  const found: string[] = [];
  const seen = new Set<string>();
  for (const re of patterns) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null && found.length < maxSnippets) {
      const s = m[0].trim().replace(/\s+/g, " ").slice(0, 220);
      if (s.length < 10) continue;
      const key = s.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(s);
    }
  }
  return found;
}

function formatSalaryContextForPrompt(jdData: JDData, jdFullText: string): string {
  const snippets = extractSalarySnippetsFromJd(jdFullText);
  const lines: string[] = [
    "SALARY & COMPENSATION CONTEXT (use for pay-related answers; do not invent numbers beyond this):",
  ];
  const structured =
    jdData.extracted?.salaryMin != null ||
    jdData.extracted?.salaryMax != null ||
    (jdData.extracted?.salaryCurrency ?? "").trim();
  if (structured) {
    lines.push(
      `- From structured job fields: min=${jdData.extracted?.salaryMin ?? "—"}, max=${jdData.extracted?.salaryMax ?? "—"}, currency=${(jdData.extracted?.salaryCurrency ?? "—").toString()}, period=${(jdData.extracted?.salaryPeriod ?? "yearly").toString()}${jdData.extracted?.salaryEstimated ? " (estimated)" : ""}.`
    );
  } else {
    lines.push("- No structured min/max salary fields were supplied with this request.");
  }
  if (snippets.length) {
    lines.push("- Verbatim or near-verbatim pay-related phrases detected in the JD text:");
    for (const s of snippets) lines.push(`  • ${s}`);
  } else {
    lines.push(
      "- No explicit pay phrases (currency, LPA, CTC, ranges) were auto-detected in the JD excerpt below; rely on full JD text if present."
    );
  }
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
          const jdCap =
            questionProfile.mode === "salary" ? 10_000 : questionProfile.includeFullJD ? 5600 : 0;
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
            questionProfile.includeFullJD && jdCap > 0
              ? `FULL JD (TRUNCATED): ${fullText.slice(0, jdCap)}`
              : "",
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

  const responseShape = buildResponseShapeInstructions(questionProfile);

  const salaryContext = formatSalaryContextForPrompt(normalizedJD, normalizedJD.content ?? "");

  const contextPrompt = `${salaryContext}

JOB METADATA:
${jobMetadata}

NORMALIZED FACTS:
${fitFacts}

JD QUOTED FACTS (use these exact phrases; do not invent new requirement names):
${jdQuotedFacts || "—"}

RESUME CONTENT:
${resumeContent}

JOB DESCRIPTION:
${jdContent}

EXPERIENCE SUMMARY:
${experienceSummary}

Use ONLY the evidence above. Be explicit about gaps when relevant: years-of-experience mismatches, missing tools, and missing leadership evidence. For pay questions, prioritize the SALARY & COMPENSATION CONTEXT block and quoted JD phrases before any general-market estimate.

Writing quality: professional and natural — not stiff, not repetitive, not robotic. Ground each point in the resume or JD (name tools, responsibilities, or requirements where possible). Every sentence must be complete and grammatically correct.

${responseShape}

When using multiple sections, put a blank line between sections.`;

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

  const temperature =
    questionProfile.mode === "salary"
      ? 0.22
      : questionProfile.mode === "cover_letter" ||
          questionProfile.mode === "linkedin" ||
          questionProfile.mode === "email"
        ? 0.32
        : 0.25;

  const model = creds.provider === "openai" ? OPENAI_CHAT_MODEL : GEMINI_CHAT_MODEL;
  const stream = createAiChatSseStream(creds.provider, creds.apiKey, {
    model,
    messages: [{ role: "system", content: buildSystemPrompt() }, ...baseMessages],
    temperature,
    topP: 0.9,
    maxTokens: questionProfile.completionTokens,
    frequencyPenalty: creds.provider === "openai" ? 0.2 : undefined,
    presencePenalty: creds.provider === "openai" ? 0 : undefined,
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
