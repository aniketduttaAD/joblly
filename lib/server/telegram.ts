import type { JobRecord } from "@/lib/types";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const MAX_MESSAGE_LENGTH = 4096;

function getBotToken(): string {
  const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return token;
}

export type InlineKeyboardButton = { text: string; callback_data: string };

export async function sendTelegramMessage(
  chatId: number,
  text: string,
  options?: { parse_mode?: "HTML" | "Markdown" }
): Promise<void> {
  const token = getBotToken();
  const baseUrl = `${TELEGRAM_API_BASE}${token}/sendMessage`;
  const chunks = splitMessage(text, MAX_MESSAGE_LENGTH);
  for (const chunk of chunks) {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text: chunk,
      disable_web_page_preview: true,
    };
    if (options?.parse_mode) body.parse_mode = options.parse_mode;
    const res = await fetch(baseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Telegram API error: ${res.status} ${err}`);
    }
  }
}

export async function sendTelegramMessageWithKeyboard(
  chatId: number,
  text: string,
  inlineKeyboard: InlineKeyboardButton[][],
  options?: { parse_mode?: "HTML" | "Markdown" }
): Promise<void> {
  const token = getBotToken();
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    reply_markup: { inline_keyboard: inlineKeyboard },
  };
  if (options?.parse_mode) body.parse_mode = options.parse_mode;
  const res = await fetch(`${TELEGRAM_API_BASE}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram API error: ${res.status} ${err}`);
  }
}

const CALLBACK_PREFIX_JOB = "job:";

export function buildJobListKeyboard(jobs: JobRecord[]): InlineKeyboardButton[][] {
  return jobs.map((j, i) => {
    const label = `${i + 1}. ${(j.title || "Untitled").slice(0, 25)} @ ${(j.company || "—").slice(0, 15)}`;
    return [{ text: label, callback_data: CALLBACK_PREFIX_JOB + j.id }];
  });
}

export function parseJobCallbackData(data: string): string | null {
  if (!data.startsWith(CALLBACK_PREFIX_JOB)) return null;
  return data.slice(CALLBACK_PREFIX_JOB.length) || null;
}

export async function answerCallbackQuery(callbackQueryId: string): Promise<void> {
  const token = getBotToken();
  const res = await fetch(`${TELEGRAM_API_BASE}${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Telegram answerCallbackQuery error: ${res.status} ${err}`);
  }
}

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    const slice = remaining.slice(0, maxLen);
    const lastNewline = slice.lastIndexOf("\n");
    const breakAt = lastNewline > maxLen * 0.5 ? lastNewline + 1 : maxLen;
    chunks.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return chunks;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function emptyStr(s: string | null | undefined): string {
  return s != null && String(s).trim() !== "" ? String(s).trim() : "—";
}

function formatSalary(job: JobRecord): string {
  const { salaryMin, salaryMax, salaryCurrency, salaryPeriod, salaryEstimated } = job;
  const period = salaryPeriod || "yearly";
  const curr = (salaryCurrency || "").trim();
  const isINRLakhs =
    (curr === "INR" || (!curr && salaryMin != null && salaryMin >= 100_000)) &&
    period === "yearly" &&
    (salaryMin == null || salaryMin >= 100_000) &&
    (salaryMax == null || salaryMax >= 100_000);
  const toLPA = (n: number) => (n / 100_000).toFixed(n % 100_000 === 0 ? 0 : 1);
  let salaryStr = "";
  if (salaryMin != null && salaryMax != null) {
    salaryStr = isINRLakhs
      ? `${curr ? curr + " " : ""}${toLPA(salaryMin)} - ${toLPA(salaryMax)} LPA`
      : `${curr ? curr + " " : ""}${salaryMin.toLocaleString()} - ${salaryMax.toLocaleString()}/${period}`;
  } else if (salaryMin != null) {
    salaryStr = isINRLakhs
      ? `${curr ? curr + " " : ""}${toLPA(salaryMin)}+ LPA`
      : `${curr ? curr + " " : ""}${salaryMin.toLocaleString()}+/${period}`;
  } else if (salaryMax != null) {
    salaryStr = isINRLakhs
      ? `${curr ? curr + " " : ""}up to ${toLPA(salaryMax)} LPA`
      : `${curr ? curr + " " : ""}up to ${salaryMax.toLocaleString()}/${period}`;
  } else {
    return "—";
  }
  return salaryEstimated ? `${salaryStr} (estimated)` : salaryStr;
}

export function formatJobFull(job: JobRecord): string {
  const lines: string[] = [
    `<b>${escapeHtml(emptyStr(job.title))}</b>`,
    `Company: ${escapeHtml(emptyStr(job.company))}${job.companyPublisher ? ` (${escapeHtml(job.companyPublisher)})` : ""}`,
    `Location: ${escapeHtml(emptyStr(job.location))}`,
    `Role: ${escapeHtml(emptyStr(job.role))}`,
    `Experience: ${escapeHtml(emptyStr(job.experience))}`,
    `Salary: ${formatSalary(job)}`,
  ];
  if (job.postedAt != null) {
    const raw = job.postedAt as unknown;
    const s =
      typeof raw === "string"
        ? raw.trim()
        : raw instanceof Date
          ? raw.toISOString()
          : String(raw).trim();
    if (s) {
      const postedStr = /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? new Date(s + "T00:00:00Z").toLocaleDateString()
        : s;
      lines.push(`Posted: ${postedStr}`);
    }
  }
  if (job.product?.trim()) lines.push(`Product: ${escapeHtml(job.product.trim())}`);
  if (job.seniority?.trim()) lines.push(`Seniority: ${escapeHtml(job.seniority.trim())}`);
  if (job.education?.trim()) lines.push(`Education: ${escapeHtml(job.education.trim())}`);
  if (job.jobType?.trim()) lines.push(`Type: ${escapeHtml(job.jobType.trim())}`);
  if (job.availability?.trim()) lines.push(`Availability: ${escapeHtml(job.availability.trim())}`);
  if (job.collaborationTools?.length)
    lines.push(`Tools: ${escapeHtml(job.collaborationTools.join(", "))}`);
  if (job.source?.trim()) lines.push(`Source: ${escapeHtml(job.source.trim())}`);
  if (job.techStack?.length) {
    lines.push(`Tech stack (${job.techStack.length}):`);
    lines.push(escapeHtml(job.techStack.join(", ")));
  }
  if (job.notes) lines.push(`Notes: ${escapeHtml(job.notes)}`);
  lines.push(`\n<code>id: ${escapeHtml(job.id)}</code>`);
  return lines.join("\n");
}

export function buildJobListText(jobs: JobRecord[]): string {
  return jobs
    .map(
      (j, i) =>
        `${i + 1}. <b>${escapeHtml(j.title || "Untitled")}</b> @ ${escapeHtml(j.company || "—")} — ${j.status}\n<code>id: ${j.id}</code>`
    )
    .join("\n");
}

export function parseCommand(text: string): { command: string; args: string[] } | null {
  const t = text?.trim();
  if (!t || !t.startsWith("/")) return null;
  const parts = t.slice(1).split(/\s+/);
  const command = (parts[0] ?? "").toLowerCase().replace(/@\w+$/, "");
  const args = parts.slice(1).filter(Boolean);
  return { command, args };
}

export function getHelpText(): string {
  return [
    "<b>Job Application Tracker Bot</b>",
    "",
    "<b>/login</b> &lt;email&gt; — Send a one-time login code to your email address.",
    "",
    "<b>/logout</b> — Sign out and lock this chat (requires /login again).",
    "",
    "<b>/add</b> — Add a job. Send this, then paste the job description in your next message.",
    "",
    "<b>/list</b> — List latest 20 jobs. Each item is clickable for full details.",
    "",
    "<b>/search</b> — Search jobs. Send /search, then your search query.",
    "",
    "/help — Show this message",
  ].join("\n");
}
