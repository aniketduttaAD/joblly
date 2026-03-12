import type { JobRecord } from "./types.ts";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";
const MAX_MESSAGE_LENGTH = 4096;

function getBotToken(): string {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
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
    if (isINRLakhs)
      salaryStr = `${curr ? curr + " " : ""}${toLPA(salaryMin)} - ${toLPA(salaryMax)} LPA`;
    else
      salaryStr = `${curr ? curr + " " : ""}${salaryMin.toLocaleString()} - ${salaryMax.toLocaleString()}/${period}`;
  } else if (salaryMin != null) {
    if (isINRLakhs) salaryStr = `${curr ? curr + " " : ""}${toLPA(salaryMin)}+ LPA`;
    else salaryStr = `${curr ? curr + " " : ""}${salaryMin.toLocaleString()}+/${period}`;
  } else if (salaryMax != null) {
    if (isINRLakhs) salaryStr = `${curr ? curr + " " : ""}up to ${toLPA(salaryMax)} LPA`;
    else salaryStr = `${curr ? curr + " " : ""}up to ${salaryMax.toLocaleString()}/${period}`;
  } else {
    return "—";
  }
  return salaryEstimated ? `${salaryStr} (estimated)` : salaryStr;
}

function emptyStr(s: string | null | undefined): string {
  return s != null && String(s).trim() !== "" ? String(s).trim() : "—";
}

export function formatJobShort(job: JobRecord, index?: number): string {
  const pre = index != null ? `${index + 1}. ` : "";
  const title = escapeHtml(emptyStr(job.title));
  const company = escapeHtml(emptyStr(job.company));
  const status = escapeHtml(job.status);
  const id = escapeHtml(job.id);
  return `${pre}<b>${title}</b> @ ${company} — ${status}\n<code>id: ${id}</code>`;
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
  if (job.postedAt?.trim()) {
    const p = job.postedAt.trim();
    const postedStr = /^\d{4}-\d{2}-\d{2}$/.test(p)
      ? new Date(p + "T00:00:00Z").toLocaleDateString()
      : p;
    lines.push(`Posted: ${postedStr}`);
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

export function formatJobList(
  jobs: JobRecord[],
  options?: { title?: string; total?: number; showIndex?: boolean }
): string {
  const { title, total, showIndex = true } = options ?? {};
  const lines: string[] = [];
  if (title) lines.push(`<b>${escapeHtml(title)}</b>\n`);
  if (jobs.length === 0) {
    lines.push("No jobs found.");
    return lines.join("\n");
  }
  jobs.forEach((j, i) => {
    lines.push(formatJobShort(j, showIndex ? i : undefined));
  });
  if (total != null && total > jobs.length) {
    lines.push(`\n<i>Showing ${jobs.length} of ${total} results.</i>`);
  }
  return lines.join("\n");
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
  const lines = [
    "<b>Job Application Tracker Bot</b>",
    "",
    "<b>/login</b> &lt;email&gt; — Send a one-time login code to your email address.",
    "",
    "<b>/logout</b> — Clear your Telegram session for this chat.",
    "",
    "<b>/add</b> — Add a job. Send this, then paste the job description in your next message. I'll parse and add it.",
    "",
    "<b>/list</b> — List latest 20 jobs. Each item is clickable; tap to see full details.",
    "",
    "<b>/search</b> — Search jobs. Send /search, then send your search query in the next message. Results are clickable for full details.",
    "",
    "/help — Show this message",
  ];
  return lines.join("\n");
}
