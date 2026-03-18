import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { errorResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/auth.ts";
import {
  readJobs,
  addJob,
  updateJob,
  deleteJob,
  deleteJobs,
  getJob,
  searchJobsByTitleCompany,
  getTelegramChatLink,
  linkTelegramChat,
  createTelegramLoginChallenge,
  getTelegramLoginChallenge,
  clearTelegramLoginChallenge,
  isTelegramChatUnlocked,
  setTelegramChatUnlocked,
  clearTelegramChatSession,
  type TelegramChatLink,
  upsertAppUser,
} from "../_shared/db.ts";
import {
  sendTelegramMessage,
  sendTelegramMessageWithKeyboard,
  parseCommand,
  getHelpText,
  formatJobFull,
  buildJobListKeyboard,
  parseJobCallbackData,
  answerCallbackQuery,
} from "../_shared/telegram.ts";
import { parseJobDescription, parseResultToJobRecord } from "../_shared/openai-parse.ts";
import type { JobRecord, JobStatus } from "../_shared/types.ts";
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
} from "../_shared/otp.ts";

const TELEGRAM_LOGIN_PROMPT = `Send <code>/login your@email.com</code> to receive a ${OTP_LENGTH}-digit sign-in code.`;
const PENDING_ADD_TTL_MS = 5 * 60 * 1000;
const PENDING_SEARCH_TTL_MS = 2 * 60 * 1000;
const PENDING_OTP_TTL_MS = 15 * 60 * 1000;
const TELEGRAM_MAX_VERIFY_ATTEMPTS = 5;
const VALID_STATUSES: JobStatus[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "rejected",
  "withdrawn",
];

const pendingAddByChat = new Map<number, number>();
const pendingSearchByChat = new Map<number, number>();

function isEmail(text: string): boolean {
  const trimmed = text.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
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

function setPendingAdd(chatId: number): void {
  pendingAddByChat.set(chatId, Date.now());
}

function clearPendingAdd(chatId: number): void {
  pendingAddByChat.delete(chatId);
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

function setPendingSearch(chatId: number): void {
  pendingSearchByChat.set(chatId, Date.now());
}

function clearPendingSearch(chatId: number): void {
  pendingSearchByChat.delete(chatId);
}

function isOtpCode(text: string): boolean {
  return isValidOtpCode(text.trim());
}

function getTelegramReloginMessage(linkedUser: TelegramChatLink | null): string {
  if (!linkedUser) {
    return `🔐 You are not logged in yet. ${TELEGRAM_LOGIN_PROMPT}`;
  }
  const label = linkedUser.name || linkedUser.email;
  return `🔐 Your Telegram session for <b>${label}</b> has expired or is invalid. Send <code>/login ${linkedUser.email}</code> to receive a new ${OTP_LENGTH}-digit code.`;
}

async function deliverOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL");

  if (!apiKey || !from) {
    throw new Error("OTP delivery is not configured.");
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
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
  if (emailLimit.limited) {
    throw new Error(
      "Too many codes sent to this email. Please wait before requesting another one."
    );
  }

  const chatLimit = await checkRateLimit("telegram_send_otp", "chat", String(chatId), {
    maxAttempts: 8,
    windowMinutes: 60,
    blockMinutes: 60,
  });
  if (chatLimit.limited) {
    throw new Error("Too many login attempts from this chat. Please try again later.");
  }

  const code = generateOtp();
  const salt = crypto.randomUUID();
  const codeHash = await hashCode(code, salt);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000).toISOString();

  await saveOtpRow(email, {
    codeHash,
    salt,
    expiresAt,
    maxAttempts: TELEGRAM_MAX_VERIFY_ATTEMPTS,
  });

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
  if (!isValidOtpCode(code)) {
    throw new Error(`Enter the ${OTP_LENGTH}-digit code from your email.`);
  }

  const emailLimit = await checkRateLimit("telegram_verify_otp", "email", email, {
    maxAttempts: 7,
    windowMinutes: 15,
    blockMinutes: 30,
  });
  if (emailLimit.limited) {
    throw new Error("Too many incorrect code attempts for this email. Please wait and try again.");
  }

  const chatLimit = await checkRateLimit("telegram_verify_otp", "chat", String(chatId), {
    maxAttempts: 12,
    windowMinutes: 15,
    blockMinutes: 30,
  });
  if (chatLimit.limited) {
    throw new Error("Too many code attempts from this chat. Please try again later.");
  }

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
    if (attemptsRemaining === 0) {
      throw new Error("Incorrect code. Maximum attempts reached. Use /login again.");
    }
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
    const supabase = createAdminClient();
    const { data: existingUsers, error: userError } = await supabase
      .from("app_users")
      .select("id")
      .eq("email", email)
      .order("created_at", { ascending: true })
      .limit(1);

    if (userError) {
      throw new Error("Unable to finish Telegram sign-in right now. Please try again.");
    }

    userId = ((existingUsers ?? [])[0] as { id: string } | undefined)?.id ?? crypto.randomUUID();
    await upsertAppUser({
      userId,
      email,
      name,
    });
  } else {
    await upsertAppUser({
      userId,
      email,
      name,
    });
  }

  return {
    userId,
    email,
    name,
  };
}

async function ensureTelegramAuthenticated(
  chatId: number,
  text: string
): Promise<TelegramChatLink | null> {
  const trimmed = text.trim();
  const parsed = parseCommand(trimmed);
  const pendingLogin = await getTelegramLoginChallenge(chatId);

  if (parsed?.command === "logout" || parsed?.command === "lock") {
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
      const message = error instanceof Error ? error.message : "Failed to send email code.";
      await sendTelegramMessage(chatId, `❌ ${message}`);
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
      const message = error instanceof Error ? error.message : "Failed to send email code.";
      await sendTelegramMessage(chatId, `❌ ${message}`);
    }
    return null;
  }

  if (pendingLogin && isOtpCode(trimmed) && !parsed) {
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
      const message =
        error instanceof Error ? error.message : "Invalid or expired code. Use /login again.";
      await sendTelegramMessage(chatId, `❌ ${message}`);
      return null;
    }
  }

  const linkedUser = await getTelegramChatLink(chatId);
  const unlocked = await isTelegramChatUnlocked(chatId);
  if (linkedUser && unlocked) {
    if (linkedUser.sessionExpiresAt) {
      const expiresAt = new Date(linkedUser.sessionExpiresAt);
      const now = new Date();
      if (!Number.isNaN(expiresAt.getTime()) && expiresAt <= now) {
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

  await sendTelegramMessage(chatId, getTelegramReloginMessage(linkedUser), {
    parse_mode: "HTML",
  });
  return null;
}

async function handleMessage(chatId: number, text: string): Promise<void> {
  const linkedUser = await ensureTelegramAuthenticated(chatId, text);
  if (!linkedUser) return;

  if (isPendingSearch(chatId)) {
    if (text.startsWith("/")) {
      clearPendingSearch(chatId);
    } else {
      clearPendingSearch(chatId);
      const query = text.trim();
      if (!query) {
        await sendTelegramMessage(
          chatId,
          "No search query received. Send /search and then your search text."
        );
        return;
      }

      const results = await searchJobsByTitleCompany(linkedUser.userId, query);
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
    clearPendingAdd(chatId);
    if (!text.trim()) {
      await sendTelegramMessage(
        chatId,
        "No text received. Use /add again and paste the job description.",
        { parse_mode: "HTML" }
      );
      return;
    }

    try {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) {
        await sendTelegramMessage(
          chatId,
          "OpenAI API key is not configured on the server. Contact the admin."
        );
        return;
      }

      const result = await parseJobDescription(text.trim(), apiKey);
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
      const message = error instanceof Error ? error.message : "Parse failed";
      await sendTelegramMessage(chatId, `❌ Parse failed: ${message}`);
    }
    return;
  }

  const parsed = parseCommand(text);
  if (!parsed) {
    await sendTelegramMessage(chatId, "Send /help for commands.");
    return;
  }

  const { command, args } = parsed;

  switch (command) {
    case "start":
    case "help": {
      await sendTelegramMessage(chatId, getHelpText(), { parse_mode: "HTML" });
      return;
    }

    case "login":
    case "logout":
    case "lock":
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

    case "search": {
      setPendingSearch(chatId);
      await sendTelegramMessage(
        chatId,
        "Send your search query in the next message (e.g. react frontend, company name, role)."
      );
      return;
    }

    case "job": {
      const id = args[0]?.trim();
      if (!id) {
        await sendTelegramMessage(chatId, "Usage: /job &lt;id&gt;");
        return;
      }
      const job = await getJob(id, linkedUser.userId);
      if (!job) {
        await sendTelegramMessage(chatId, "Job not found.");
        return;
      }
      await sendTelegramMessage(chatId, formatJobFull(job), { parse_mode: "HTML" });
      return;
    }

    case "add": {
      setPendingAdd(chatId);
      await sendTelegramMessage(
        chatId,
        "Paste the job description in your next message. I'll parse it and add the job. (Cancel by sending any command.)"
      );
      return;
    }

    case "delete": {
      const id = args[0]?.trim();
      if (!id) {
        await sendTelegramMessage(chatId, "Usage: /delete &lt;id&gt;");
        return;
      }
      const ok = await deleteJob(id, linkedUser.userId);
      await sendTelegramMessage(chatId, ok ? "✅ Deleted." : "Job not found.");
      return;
    }

    case "delete_bulk": {
      const ids = args.map((a) => a.trim()).filter(Boolean);
      if (ids.length === 0) {
        await sendTelegramMessage(chatId, "Usage: /delete_bulk &lt;id1&gt; &lt;id2&gt; …");
        return;
      }
      const removed = await deleteJobs(ids, linkedUser.userId);
      if (removed === 0) {
        await sendTelegramMessage(chatId, "No matching jobs were found for those ids.");
        return;
      }
      await sendTelegramMessage(chatId, `✅ Deleted ${removed} job(s).`);
      return;
    }

    case "status": {
      const id = args[0]?.trim();
      const status = args[1]?.trim()?.toLowerCase();
      if (!id || !status) {
        await sendTelegramMessage(
          chatId,
          "Usage: /status &lt;id&gt; &lt;status&gt;\nStatus: applied, screening, interview, offer, rejected, withdrawn"
        );
        return;
      }
      if (!VALID_STATUSES.includes(status as JobStatus)) {
        await sendTelegramMessage(
          chatId,
          `Invalid status. Use one of: ${VALID_STATUSES.join(", ")}`
        );
        return;
      }
      const updated = await updateJob(id, linkedUser.userId, { status: status as JobStatus });
      if (!updated) {
        await sendTelegramMessage(chatId, "Job not found.");
        return;
      }
      await sendTelegramMessage(chatId, `✅ Status updated to <b>${status}</b>.`, {
        parse_mode: "HTML",
      });
      return;
    }

    default: {
      await sendTelegramMessage(chatId, "Unknown command. Send /help for usage.");
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
  if (secret) {
    const url = new URL(req.url);
    const urlSecret = url.searchParams.get("secret");
    const headerSecret = req.headers.get("x-telegram-webhook-secret");
    if (urlSecret !== secret && headerSecret !== secret) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (!Deno.env.get("TELEGRAM_BOT_TOKEN")) {
    return new Response(JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not set" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ok = new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });

  const update = body as {
    message?: { chat: { id: number }; text?: string };
    callback_query?: {
      id: string;
      data?: string;
      message?: { chat: { id: number } };
    };
  };

  if (update.callback_query?.id != null) {
    const callbackQuery = update.callback_query;
    const jobId = callbackQuery.data != null ? parseJobCallbackData(callbackQuery.data) : null;
    const chatId = callbackQuery.message?.chat?.id;

    try {
      await answerCallbackQuery(callbackQuery.id);
      if (jobId != null && chatId != null) {
        const linkedUser = await getTelegramChatLink(chatId);
        if (!linkedUser || !(await isTelegramChatUnlocked(chatId))) {
          await sendTelegramMessage(chatId, getTelegramReloginMessage(linkedUser), {
            parse_mode: "HTML",
          });
        } else {
          const job = await getJob(jobId, linkedUser.userId);
          if (job) {
            await sendTelegramMessage(chatId, formatJobFull(job), { parse_mode: "HTML" });
          } else {
            await sendTelegramMessage(chatId, "Job not found.");
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error";
      if (chatId != null) {
        await sendTelegramMessage(chatId, `❌ ${message}`).catch(() => {});
      }
    }
    return ok;
  }

  const message = update.message;
  if (!message?.chat?.id) return ok;

  const chatId = message.chat.id;
  const text = message.text?.trim();

  if (!text) {
    await sendTelegramMessage(chatId, "Send /help for commands.");
    return ok;
  }

  try {
    await handleMessage(chatId, text);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Something went wrong";
    await sendTelegramMessage(chatId, `❌ Error: ${msg}`).catch(() => {});
  }

  return ok;
});
