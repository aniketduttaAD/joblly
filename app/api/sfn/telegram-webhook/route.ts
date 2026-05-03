import { NextRequest, NextResponse } from "next/server";
import {
  readJobs,
  addJob,
  updateJob,
  deleteJob,
  deleteJobWithCheck,
  getJob,
  searchJobsByTitleCompany,
} from "@/lib/server/jobs";
import {
  getTelegramChatLink,
  linkTelegramChat,
  createTelegramLoginChallenge,
  getTelegramLoginChallenge,
  clearTelegramLoginChallenge,
  isTelegramChatUnlocked,
  setTelegramChatUnlocked,
  clearTelegramChatSession,
  upsertAppUser,
} from "@/lib/server/telegram-db";
import {
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  parseCommand,
  getHelpText,
  formatJobFull,
  buildJobListKeyboard,
  parseJobCallbackData,
  answerCallbackQuery,
} from "@/lib/server/telegram";
import {
  OTP_EXPIRY_MINUTES,
  OTP_LENGTH,
  checkRateLimit,
  clearRateLimit,
  deleteOtpRows,
  generateOtp,
  getLatestOtpRow,
  hashCode,
  incrementOtpAttempt,
  incrementRateLimit,
  isValidEmail,
  isValidOtpCode,
  normalizeEmail,
  saveOtpRow,
  timingSafeEqual,
} from "@/lib/server/otp";
import { parseJobDescription, parseResultToJobRecord } from "@/lib/server/openai-parse";
import type { JobRecord, JobStatus } from "@/lib/types";

export const runtime = "nodejs";

const VALID_STATUSES: JobStatus[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];
const PENDING_ADD_TTL_MS = 5 * 60 * 1000;
const PENDING_SEARCH_TTL_MS = 2 * 60 * 1000;
const PENDING_OTP_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_MAX_VERIFY_ATTEMPTS = 5;
const TELEGRAM_LOGIN_PROMPT = `Send <code>/login your@email.com</code> to receive a ${OTP_LENGTH}-digit sign-in code.`;

// In-memory pending state (serverless: per-process, short-lived — fine for TTL-gated flows)
const pendingAddByChat = new Map<number, number>();
const pendingSearchByChat = new Map<number, number>();

function isEmail(text: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim());
}

function isPendingAdd(chatId: number): boolean {
  const ts = pendingAddByChat.get(chatId);
  if (ts == null) return false;
  if (Date.now() - ts > PENDING_ADD_TTL_MS) {
    pendingAddByChat.delete(chatId);
    return false;
  }
  return true;
}

function isPendingSearch(chatId: number): boolean {
  const ts = pendingSearchByChat.get(chatId);
  if (ts == null) return false;
  if (Date.now() - ts > PENDING_SEARCH_TTL_MS) {
    pendingSearchByChat.delete(chatId);
    return false;
  }
  return true;
}

function getTelegramReloginMessage(
  linkedUser: { name?: string | null; email: string } | null
): string {
  if (!linkedUser) return `🔐 You are not logged in yet. ${TELEGRAM_LOGIN_PROMPT}`;
  const label = linkedUser.name || linkedUser.email;
  return `🔐 Your Telegram session for <b>${label}</b> has expired or is invalid. Send <code>/login ${linkedUser.email}</code> to receive a new ${OTP_LENGTH}-digit code.`;
}

async function deliverOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("OTP delivery is not configured.");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      from,
      to: [email],
      subject: "Your sign-in code",
      html: `<p>Your verification code is <strong>${code}</strong>. It will expire in ${OTP_EXPIRY_MINUTES} minutes.</p>`,
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Failed to send OTP: ${res.status} ${err}`);
  }
}

async function sendTelegramOtp(chatId: number, rawEmail: string): Promise<string> {
  const email = normalizeEmail(rawEmail);
  if (!email) throw new Error("Email is required.");
  if (!isValidEmail(email)) throw new Error("Enter a valid email address.");

  const emailLimit = await checkRateLimit("telegram_send_otp", "email", email, {
    maxAttempts: 5,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  if (emailLimit.limited)
    throw new Error(
      "Too many codes sent to this email. Please wait before requesting another one."
    );

  const chatLimit = await checkRateLimit("telegram_send_otp", "chat", String(chatId), {
    maxAttempts: 8,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  if (chatLimit.limited)
    throw new Error("Too many login attempts from this chat. Please try again later.");

  const code = generateOtp();
  const salt = crypto.randomUUID();
  const codeHash = await hashCode(code, salt);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();

  await saveOtpRow(email, { codeHash, salt, expiresAt, maxAttempts: TELEGRAM_MAX_VERIFY_ATTEMPTS });

  try {
    await deliverOtpEmail(email, code);
  } catch (error) {
    await deleteOtpRows(email);
    throw error;
  }

  await incrementRateLimit("telegram_send_otp", "email", email, {
    maxAttempts: 5,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  await incrementRateLimit("telegram_send_otp", "chat", String(chatId), {
    maxAttempts: 8,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  return email;
}

async function verifyTelegramOtp(
  chatId: number,
  rawEmail: string,
  token: string
): Promise<{ userId: string; email: string; name: string | null }> {
  const email = normalizeEmail(rawEmail);
  const code = token.trim();
  if (!isValidOtpCode(code)) throw new Error(`Enter the ${OTP_LENGTH}-digit code from your email.`);

  const emailLimit = await checkRateLimit("telegram_verify_otp", "email", email, {
    maxAttempts: 7,
    windowMinutes: 15,
    blockMinutes: 30,
  });
  if (emailLimit.limited)
    throw new Error("Too many incorrect code attempts for this email. Please wait and try again.");

  const chatLimit = await checkRateLimit("telegram_verify_otp", "chat", String(chatId), {
    maxAttempts: 12,
    windowMinutes: 15,
    blockMinutes: 30,
  });
  if (chatLimit.limited)
    throw new Error("Too many code attempts from this chat. Please try again later.");

  const row = await getLatestOtpRow(email);
  if (!row) {
    await incrementRateLimit("telegram_verify_otp", "email", email, {
      maxAttempts: 7,
      windowMinutes: 15,
      blockMinutes: 30,
    });
    await incrementRateLimit("telegram_verify_otp", "chat", String(chatId), {
      maxAttempts: 12,
      windowMinutes: 15,
      blockMinutes: 30,
    });
    throw new Error("This code has expired. Use /login again.");
  }

  const now = new Date();
  const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
  if (blockedUntil && !Number.isNaN(blockedUntil.getTime()) && blockedUntil > now) {
    throw new Error("Too many incorrect code attempts. Use /login again later.");
  }

  const expiresAt = new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt <= now) {
    await deleteOtpRows(email);
    throw new Error("This code has expired. Use /login again.");
  }

  const computedHash = await hashCode(code, row.salt);
  const isMatch = timingSafeEqual(computedHash, row.code_hash);
  if (!isMatch) {
    const nextAttempts = await incrementOtpAttempt(row);
    await incrementRateLimit("telegram_verify_otp", "email", email, {
      maxAttempts: 7,
      windowMinutes: 15,
      blockMinutes: 30,
    });
    await incrementRateLimit("telegram_verify_otp", "chat", String(chatId), {
      maxAttempts: 12,
      windowMinutes: 15,
      blockMinutes: 30,
    });
    const attemptsRemaining = Math.max(
      0,
      (row.max_attempts ?? TELEGRAM_MAX_VERIFY_ATTEMPTS) - nextAttempts
    );
    if (attemptsRemaining === 0)
      throw new Error("Incorrect code. Maximum attempts reached. Use /login again.");
    throw new Error(
      `Incorrect code. ${attemptsRemaining} attempt${attemptsRemaining === 1 ? "" : "s"} remaining.`
    );
  }

  await deleteOtpRows(email);
  await clearRateLimit("telegram_verify_otp", "email", email);
  await clearRateLimit("telegram_verify_otp", "chat", String(chatId));

  const linkedUser = await getTelegramChatLink(chatId);
  let userId = linkedUser?.userId ?? "";
  const name = linkedUser?.name ?? null;

  if (!userId) {
    // Look up existing user by email in app_users
    userId = await findOrCreateUserId(email);
  }

  await upsertAppUser({ userId, email, name });
  return { userId, email, name };
}

async function findOrCreateUserId(email: string): Promise<string> {
  const { getSql } = await import("@/lib/server/neon");
  const sql = getSql();
  const rows =
    (await sql`select id from public.app_users where email = ${email} order by created_at asc limit 1`) as Array<{
      id: string;
    }>;
  return rows[0]?.id ?? crypto.randomUUID();
}

async function ensureTelegramAuthenticated(chatId: number, text: string) {
  const trimmed = text.trim();
  const parsed = parseCommand(trimmed);
  const pendingLogin = await getTelegramLoginChallenge(chatId);

  if (parsed?.command === "logout") {
    await clearTelegramChatSession(chatId);
    await clearTelegramLoginChallenge(chatId);
    const linkedUser = await getTelegramChatLink(chatId);
    await sendTelegramMessage(
      chatId,
      `🔒 Session cleared. ${getTelegramReloginMessage(linkedUser)}`,
      { parse_mode: "HTML" }
    );
    return null;
  }

  if (!parsed && !pendingLogin && isEmail(trimmed)) {
    const email = trimmed.toLowerCase();
    try {
      await sendTelegramOtp(chatId, email);
      await createTelegramLoginChallenge({
        chatId,
        email,
        userId: "",
        phrase: null,
        expiresAt: new Date(Date.now() + PENDING_OTP_TTL_MS).toISOString(),
      });
      await sendTelegramMessage(
        chatId,
        `📧 Code sent to <b>${email}</b>. Reply with the ${OTP_LENGTH}-digit code from your email.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await sendTelegramMessage(
        chatId,
        `❌ ${error instanceof Error ? error.message : "Failed to send email code."}`
      );
    }
    return null;
  }

  if (parsed?.command === "login") {
    const email = parsed.args[0]?.trim().toLowerCase();
    if (!email) {
      await sendTelegramMessage(chatId, "Usage: /login your@email.com");
      return null;
    }
    try {
      await sendTelegramOtp(chatId, email);
      await createTelegramLoginChallenge({
        chatId,
        email,
        userId: "",
        phrase: null,
        expiresAt: new Date(Date.now() + PENDING_OTP_TTL_MS).toISOString(),
      });
      await sendTelegramMessage(
        chatId,
        `📧 Code sent to <b>${email}</b>. Reply with the ${OTP_LENGTH}-digit code from your email.`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await sendTelegramMessage(
        chatId,
        `❌ ${error instanceof Error ? error.message : "Failed to send email code."}`
      );
    }
    return null;
  }

  if (pendingLogin && isValidOtpCode(trimmed) && !parsed) {
    try {
      const userInfo = await verifyTelegramOtp(chatId, pendingLogin.email, trimmed);
      await linkTelegramChat(chatId, userInfo);
      await setTelegramChatUnlocked(chatId);
      await clearTelegramLoginChallenge(chatId);
      await sendTelegramMessage(
        chatId,
        `✅ Logged in as <b>${userInfo.name || userInfo.email}</b>.\n\n${getHelpText()}`,
        { parse_mode: "HTML" }
      );
      return await getTelegramChatLink(chatId);
    } catch (error) {
      await sendTelegramMessage(
        chatId,
        `❌ ${error instanceof Error ? error.message : "Invalid or expired code. Use /login again."}`
      );
      return null;
    }
  }

  const linkedUser = await getTelegramChatLink(chatId);
  const unlocked = await isTelegramChatUnlocked(chatId);
  if (linkedUser && unlocked) {
    if (linkedUser.sessionExpiresAt) {
      const expiresAt = new Date(linkedUser.sessionExpiresAt);
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= new Date()) {
        await clearTelegramChatSession(chatId);
        await sendTelegramMessage(chatId, getTelegramReloginMessage(linkedUser), {
          parse_mode: "HTML",
        });
        return null;
      }
    }
    return linkedUser;
  }

  if (pendingLogin) {
    await sendTelegramMessage(
      chatId,
      `Reply with the ${OTP_LENGTH}-digit code sent to <b>${pendingLogin.email}</b>.`,
      { parse_mode: "HTML" }
    );
    return null;
  }

  await sendTelegramMessage(chatId, getTelegramReloginMessage(linkedUser), { parse_mode: "HTML" });
  return null;
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  const linkedUser = await ensureTelegramAuthenticated(chatId, text);
  if (!linkedUser) return;

  if (isPendingSearch(chatId)) {
    if (text.startsWith("/")) {
      pendingSearchByChat.delete(chatId);
    } else {
      pendingSearchByChat.delete(chatId);
      const query = text.trim();
      if (!query) {
        await sendTelegramMessage(
          chatId,
          "No search query received. Send /search and then your search text."
        );
        return;
      }
      const results = await searchJobsByTitleCompany(linkedUser.userId, query, undefined, {
        limit: 20,
        offset: 0,
      });
      if (results.jobs.length === 0) {
        await sendTelegramMessage(chatId, `No jobs found for "${query}".`);
        return;
      }
      await sendTelegramMessageWithKeyboard(
        chatId,
        `Search: "${query}" — ${results.total} result(s). Tap an item for full details.`,
        buildJobListKeyboard(results.jobs),
        { parse_mode: "HTML" }
      );
      return;
    }
  }

  if (isPendingAdd(chatId)) {
    pendingAddByChat.delete(chatId);
    if (!text.trim()) {
      await sendTelegramMessage(
        chatId,
        "No text received. Use /add again and paste the job description."
      );
      return;
    }
    try {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        await sendTelegramMessage(
          chatId,
          "OpenAI API key is not configured on the server. Contact the admin."
        );
        return;
      }
      const result = await parseJobDescription(text.trim(), {
        provider: "openai",
        apiKey,
      });
      const partial = parseResultToJobRecord(result, text.trim());
      const now = new Date().toISOString();
      const job: JobRecord = {
        id: crypto.randomUUID(),
        ...partial,
        status: "applied",
        appliedAt: partial.appliedAt ?? now,
        createdAt: now,
        updatedAt: now,
      };
      await addJob(job, {
        userId: linkedUser.userId,
        email: linkedUser.email,
        name: linkedUser.name ?? null,
      });
      await sendTelegramMessage(
        chatId,
        `✅ Added: <b>${job.title || "Untitled"}</b> at ${job.company || "—"}\n<code>id: ${job.id}</code>`,
        { parse_mode: "HTML" }
      );
    } catch (error) {
      await sendTelegramMessage(
        chatId,
        `❌ Parse failed: ${error instanceof Error ? error.message : "Parse failed"}`
      );
    }
    return;
  }

  const parsed = parseCommand(text);
  if (!parsed) {
    await sendTelegramMessage(chatId, "Send /help for available commands.");
    return;
  }
  const { command, args } = parsed;

  switch (command) {
    case "start":
    case "help":
      await sendTelegramMessage(chatId, getHelpText(), { parse_mode: "HTML" });
      return;

    case "login":
    case "logout":
      return;

    case "list": {
      const data = await readJobs(linkedUser.userId);
      const jobs = (data.jobs ?? []).slice(0, 20);
      if (jobs.length === 0) {
        await sendTelegramMessage(chatId, "No jobs yet. Use /add to add one.");
        return;
      }
      await sendTelegramMessageWithKeyboard(
        chatId,
        `Latest ${jobs.length} job(s). Tap an item for full details.`,
        buildJobListKeyboard(jobs),
        { parse_mode: "HTML" }
      );
      return;
    }

    case "search":
      pendingSearchByChat.set(chatId, Date.now());
      await sendTelegramMessage(
        chatId,
        "Send your search query in the next message (e.g. react frontend, company name, role)."
      );
      return;

    case "add":
      pendingAddByChat.set(chatId, Date.now());
      await sendTelegramMessage(
        chatId,
        "Paste the job description in your next message. I'll parse it and add the job. (Cancel by sending any command.)"
      );
      return;

    default:
      await sendTelegramMessage(chatId, "Unknown command. Send /help for available commands.");
  }
}

const ok = () => NextResponse.json({ ok: true });

export async function POST(req: NextRequest) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (secret) {
    const url = new URL(req.url);
    const urlSecret = url.searchParams.get("secret");
    const headerSecret = req.headers.get("x-telegram-webhook-secret");
    if (urlSecret !== secret && headerSecret !== secret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return NextResponse.json({ error: "TELEGRAM_BOT_TOKEN not set" }, { status: 503 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const update = body as {
    message?: { chat: { id: number }; text?: string };
    callback_query?: { id: string; data?: string; message?: { chat: { id: number } } };
  };

  if (update.callback_query?.id != null) {
    const cq = update.callback_query;
    const jobId = cq.data != null ? parseJobCallbackData(cq.data) : null;
    const chatId = cq.message?.chat?.id;
    try {
      await answerCallbackQuery(cq.id);
      if (jobId != null && chatId != null) {
        const linkedUser = await getTelegramChatLink(chatId);
        if (!linkedUser || !(await isTelegramChatUnlocked(chatId))) {
          await sendTelegramMessage(chatId, getTelegramReloginMessage(linkedUser), {
            parse_mode: "HTML",
          });
        } else {
          const job = await getJob(jobId, linkedUser.userId);
          if (job) await sendTelegramMessage(chatId, formatJobFull(job), { parse_mode: "HTML" });
          else await sendTelegramMessage(chatId, "Job not found.");
        }
      }
    } catch (error) {
      if (chatId != null)
        await sendTelegramMessage(
          chatId,
          `❌ ${error instanceof Error ? error.message : "Error"}`
        ).catch(() => {});
    }
    return ok();
  }

  const message = update.message;
  if (!message?.chat?.id) return ok();

  const chatId = message.chat.id;
  const text = message.text?.trim();
  if (!text) {
    await sendTelegramMessage(chatId, "Send /help for commands.");
    return ok();
  }

  try {
    await handleMessage(chatId, text);
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `❌ Error: ${error instanceof Error ? error.message : "Something went wrong"}`
    ).catch(() => {});
  }

  return ok();
}
