import { getSql } from "./neon";

export interface TelegramChatLink {
  chatId: number;
  userId: string;
  email: string;
  name: string | null;
  sessionExpiresAt?: string | null;
}

export interface TelegramLoginChallenge {
  chatId: number;
  email: string;
  userId: string;
  phrase?: string | null;
  expiresAt: string;
}

const SESSION_TTL_MS = 15 * 24 * 60 * 60 * 1000; // 15 days

export async function upsertAppUser(identity: {
  userId: string;
  email: string;
  name: string | null;
}): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();
  await sql`
    insert into public.app_users (id, email, name, created_at, updated_at)
    values (${identity.userId}, ${identity.email}, ${identity.name ?? null}, ${now}, ${now})
    on conflict (id) do update set
      email = excluded.email,
      name = coalesce(excluded.name, public.app_users.name),
      updated_at = excluded.updated_at
  `;
}

export async function getTelegramChatLink(chatId: number): Promise<TelegramChatLink | null> {
  const sql = getSql();
  const rows = (await sql`
    select chat_id, user_id, email, name, session_expires_at
    from public.telegram_chat_links
    where chat_id = ${String(chatId)}
    limit 1
  `) as Array<{
    chat_id: string;
    user_id: string;
    email: string;
    name: string | null;
    session_expires_at: string | null;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    chatId: Number(row.chat_id),
    userId: row.user_id,
    email: row.email,
    name: row.name,
    sessionExpiresAt: row.session_expires_at,
  };
}

export async function linkTelegramChat(
  chatId: number,
  identity: { userId: string; email: string; name: string | null }
): Promise<void> {
  await upsertAppUser(identity);
  const sql = getSql();
  const now = new Date().toISOString();
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await sql`
    insert into public.telegram_chat_links (chat_id, user_id, email, name, session_expires_at, created_at, updated_at)
    values (${String(chatId)}, ${identity.userId}, ${identity.email}, ${identity.name ?? null}, ${sessionExpiresAt}, ${now}, ${now})
    on conflict (chat_id) do update set
      user_id = excluded.user_id,
      email = excluded.email,
      name = excluded.name,
      session_expires_at = excluded.session_expires_at,
      updated_at = excluded.updated_at
  `;
}

export async function createTelegramLoginChallenge(
  challenge: TelegramLoginChallenge
): Promise<void> {
  const sql = getSql();
  const now = new Date().toISOString();
  await sql`
    insert into public.telegram_login_challenges (chat_id, email, user_id, phrase, expires_at, created_at)
    values (${String(challenge.chatId)}, ${challenge.email}, ${challenge.userId}, ${challenge.phrase ?? null}, ${challenge.expiresAt}, ${now})
    on conflict (chat_id) do update set
      email = excluded.email,
      user_id = excluded.user_id,
      phrase = excluded.phrase,
      expires_at = excluded.expires_at,
      created_at = excluded.created_at
  `;
}

export async function getTelegramLoginChallenge(
  chatId: number
): Promise<TelegramLoginChallenge | null> {
  const sql = getSql();
  const rows = (await sql`
    select chat_id, email, user_id, phrase, expires_at
    from public.telegram_login_challenges
    where chat_id = ${String(chatId)} and expires_at > ${new Date().toISOString()}
    limit 1
  `) as Array<{
    chat_id: string;
    email: string;
    user_id: string;
    phrase: string | null;
    expires_at: string;
  }>;
  const row = rows[0];
  if (!row) return null;
  return {
    chatId: Number(row.chat_id),
    email: row.email,
    userId: row.user_id,
    phrase: row.phrase,
    expiresAt: row.expires_at,
  };
}

export async function clearTelegramLoginChallenge(chatId: number): Promise<void> {
  const sql = getSql();
  await sql`delete from public.telegram_login_challenges where chat_id = ${String(chatId)}`;
}

// session helpers stored in `sessions` table
async function createSession(
  sessionType: string,
  identifier: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<void> {
  const sql = getSql();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const now = new Date().toISOString();
  await sql`
    insert into public.sessions (session_id, session_type, identifier, expires_at, created_at)
    values (${sessionId}, ${sessionType}, ${identifier}, ${expiresAt}, ${now})
    on conflict (session_type, identifier) do update set
      session_id = excluded.session_id,
      expires_at = excluded.expires_at
  `;
}

async function getSession(
  sessionType: string,
  identifier: string
): Promise<{ sessionId: string } | null> {
  const sql = getSql();
  const rows = (await sql`
    select session_id from public.sessions
    where session_type = ${sessionType} and identifier = ${identifier}
      and expires_at > ${new Date().toISOString()}
    limit 1
  `) as Array<{ session_id: string }>;
  return rows[0] ? { sessionId: rows[0].session_id } : null;
}

async function deleteSession(sessionType: string, identifier: string): Promise<void> {
  const sql = getSql();
  await sql`delete from public.sessions where session_type = ${sessionType} and identifier = ${identifier}`;
}

export async function isTelegramChatUnlocked(chatId: number): Promise<boolean> {
  return (await getSession("telegram", String(chatId))) !== null;
}

export async function setTelegramChatUnlocked(chatId: number): Promise<void> {
  await createSession("telegram", String(chatId));
}

export async function clearTelegramChatSession(chatId: number): Promise<void> {
  await deleteSession("telegram", String(chatId));
}
