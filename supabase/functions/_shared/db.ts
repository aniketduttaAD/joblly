import { createAdminClient } from "./auth.ts";
import type { JobRecord, JobStatus, TechStackNormalized, Resume, ParsedResume } from "./types.ts";
import type { AuthenticatedUserIdentity } from "./auth.ts";

function rowToJobRecord(row: Record<string, unknown>): JobRecord {
  return {
    id: (row.job_id as string) || (row.id as string),
    title: (row.title as string) ?? "",
    company: (row.company as string) ?? "",
    companyPublisher: (row.company_publisher as string | null) ?? null,
    location: (row.location as string) ?? "",
    salaryMin: (row.salary_min as number | null) ?? null,
    salaryMax: (row.salary_max as number | null) ?? null,
    salaryCurrency: (row.salary_currency as string | null) ?? null,
    salaryPeriod:
      row.salary_period === "hourly" ||
      row.salary_period === "monthly" ||
      row.salary_period === "yearly"
        ? (row.salary_period as "hourly" | "monthly" | "yearly")
        : undefined,
    salaryEstimated: (row.salary_estimated as boolean) ?? false,
    techStack: Array.isArray(row.tech_stack) ? (row.tech_stack as string[]) : [],
    techStackNormalized: row.tech_stack_normalized
      ? (JSON.parse(row.tech_stack_normalized as string) as TechStackNormalized)
      : null,
    role: (row.role as string) ?? "",
    experience: (row.experience as string) ?? "Not specified",
    jobType: (row.job_type as string | null) ?? null,
    availability: (row.availability as string | null) ?? null,
    product: (row.product as string | null) ?? null,
    seniority: (row.seniority as string | null) ?? null,
    collaborationTools: Array.isArray(row.collaboration_tools)
      ? (row.collaboration_tools as string[])
      : null,
    status: ((row.status as string) ?? "applied") as JobStatus,
    appliedAt: (row.applied_at as string) ?? new Date().toISOString(),
    postedAt: (row.posted_at as string | null) ?? null,
    applicantsCount: (row.applicants_count as number | null) ?? null,
    education: (row.education as string | null) ?? null,
    source: (row.source as string | undefined) ?? undefined,
    jdRaw: (row.jd_raw as string | undefined) ?? undefined,
    notes: (row.notes as string | undefined) ?? undefined,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

function jobRecordToRow(job: JobRecord, owner: AuthenticatedUserIdentity): Record<string, unknown> {
  return {
    id: job.id,
    job_id: job.id,
    owner_id: owner.userId,
    owner_email: owner.email,
    owner_name: owner.name ?? null,
    title: job.title,
    company: job.company,
    company_publisher: job.companyPublisher ?? null,
    location: job.location,
    salary_min: job.salaryMin ?? null,
    salary_max: job.salaryMax ?? null,
    salary_currency: job.salaryCurrency ?? null,
    salary_period: job.salaryPeriod ?? null,
    salary_estimated: job.salaryEstimated ?? false,
    tech_stack: job.techStack,
    tech_stack_normalized: job.techStackNormalized ? JSON.stringify(job.techStackNormalized) : null,
    role: job.role,
    experience: job.experience,
    job_type: job.jobType ?? null,
    availability: job.availability ?? null,
    product: job.product ?? null,
    seniority: job.seniority ?? null,
    collaboration_tools: job.collaborationTools ?? [],
    status: job.status,
    applied_at: job.appliedAt,
    posted_at: job.postedAt ?? null,
    applicants_count: job.applicantsCount ?? null,
    education: job.education ?? null,
    source: job.source ?? null,
    jd_raw: job.jdRaw ?? null,
    notes: job.notes ?? null,
    created_at: job.createdAt,
    updated_at: job.updatedAt,
  };
}

export interface JobsPaginatedResult {
  jobs: JobRecord[];
  total: number;
  updatedAt: string;
}

export interface JobsStats {
  total: number;
  appliedThisWeek: number;
  statusCounts: Record<JobStatus, number>;
}

export async function readJobsForDuplicateCheck(
  ownerId: string
): Promise<{ title: string; company: string; techStack: string[] }[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("title, company, tech_stack")
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map((row) => ({
    title: (row.title as string) ?? "",
    company: (row.company as string) ?? "",
    techStack: Array.isArray(row.tech_stack) ? (row.tech_stack as string[]) : [],
  }));
}

export async function readJobs(ownerId: string): Promise<{ jobs: JobRecord[]; updatedAt: string }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false });

  if (error) throw error;
  const jobs = (data ?? []).map(rowToJobRecord);
  const updatedAt =
    jobs.length > 0
      ? jobs.reduce((latest, j) => (j.updatedAt > latest ? j.updatedAt : latest), jobs[0].updatedAt)
      : new Date().toISOString();
  return { jobs, updatedAt };
}

export async function readJobsPaginated(
  ownerId: string,
  page: number,
  limit: number
): Promise<JobsPaginatedResult> {
  const supabase = createAdminClient();
  const offset = Math.max(0, (page - 1) * limit);
  const { data, error, count } = await supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) throw error;
  const jobs = (data ?? []).map(rowToJobRecord);
  const updatedAt =
    jobs.length > 0
      ? jobs.reduce((latest, j) => (j.updatedAt > latest ? j.updatedAt : latest), jobs[0].updatedAt)
      : new Date().toISOString();
  return { jobs, total: count ?? 0, updatedAt };
}

export async function readJobsStats(ownerId: string): Promise<JobsStats> {
  const { jobs } = await readJobs(ownerId);
  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(now.getDate() - 7);
  const appliedThisWeek = jobs.filter((job) => {
    const d = new Date(job.appliedAt);
    return !Number.isNaN(d.getTime()) && d >= oneWeekAgo && d <= now;
  }).length;
  const statusCounts: Record<JobStatus, number> = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  };
  for (const job of jobs) {
    statusCounts[job.status] = (statusCounts[job.status] ?? 0) + 1;
  }
  return { total: jobs.length, appliedThisWeek, statusCounts };
}

export async function getJob(id: string, ownerId: string): Promise<JobRecord | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return rowToJobRecord(data);
}

export async function addJob(job: JobRecord, owner: AuthenticatedUserIdentity): Promise<JobRecord> {
  const supabase = createAdminClient();
  const row = jobRecordToRow(job, owner);
  const { error } = await supabase.from("jobs").insert(row);
  if (error) throw error;
  return job;
}

export async function updateJob(
  id: string,
  ownerId: string,
  updates: Partial<JobRecord>
): Promise<JobRecord | null> {
  const current = await getJob(id, ownerId);
  if (!current) return null;

  const merged: JobRecord = {
    ...current,
    ...updates,
    id,
    updatedAt: new Date().toISOString(),
  };

  const supabase = createAdminClient();
  const row = jobRecordToRow(merged, { userId: ownerId, email: "", name: undefined });
  const { owner_id: _ownerId, owner_email: _e, owner_name: _n, ...jobCols } = row;

  const { error } = await supabase
    .from("jobs")
    .update(jobCols)
    .eq("id", id)
    .eq("owner_id", ownerId);
  if (error) throw error;
  return merged;
}

export async function deleteJob(id: string, ownerId: string): Promise<boolean> {
  const job = await getJob(id, ownerId);
  if (!job) return false;
  const supabase = createAdminClient();
  const { error } = await supabase.from("jobs").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;
  return true;
}

export async function deleteJobs(ids: string[], ownerId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const results = await Promise.all(ids.map((id) => deleteJob(id, ownerId)));
  return results.filter(Boolean).length;
}

/**
 * Search jobs by title and/or company (FTS) with optional status filter.
 * When q is empty but status is set, returns jobs filtered by status only (uses owner_id + status index).
 */
export async function searchJobsByTitleCompany(
  ownerId: string,
  q: string,
  status?: JobStatus
): Promise<{ jobs: JobRecord[]; total: number }> {
  const trimmed = q.trim();
  const supabase = createAdminClient();

  if (!trimmed) {
    if (!status) return { jobs: [], total: 0 };
    const { data, error, count } = await supabase
      .from("jobs")
      .select("*", { count: "exact" })
      .eq("owner_id", ownerId)
      .eq("status", status)
      .order("applied_at", { ascending: false });
    if (error) throw error;
    const jobs = (data ?? []).map(rowToJobRecord);
    return { jobs, total: count ?? jobs.length };
  }

  const search = trimmed.replace(/[':]/g, " ").replace(/\s+/g, " ").trim();
  let query = supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .or(`title.fts.${search},company.fts.${search}`)
    .order("applied_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) throw error;
  const jobs = (data ?? []).map(rowToJobRecord);
  return { jobs, total: count ?? jobs.length };
}

function rowToResume(row: Record<string, unknown>): Resume {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    content: (row.content as string) ?? "",
    parsedContent: row.parsed_content
      ? (JSON.parse(row.parsed_content as string) as ParsedResume)
      : ({} as ParsedResume),
    isVerified: (row.is_verified as boolean) ?? false,
    createdAt: new Date((row.created_at as string) ?? new Date().toISOString()),
    updatedAt: new Date((row.updated_at as string) ?? new Date().toISOString()),
    sourceFileName: (row.source_file_name as string) ?? "",
    fileSize: (row.file_size as number) ?? 0,
    previewUrl: `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/resume-file?id=${row.id as string}`,
  };
}

export async function listResumes(ownerId: string): Promise<Resume[]> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("owner_id", ownerId)
    .order("updated_at", { ascending: false });

  if (error) throw error;
  return (data ?? []).map(rowToResume);
}

export async function getResume(id: string, ownerId: string): Promise<Resume | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;
  return rowToResume(data);
}

export interface ResumeAssetPayload {
  content: string;
  parsedContent: ParsedResume;
}

export async function createResume(
  id: string,
  owner: AuthenticatedUserIdentity,
  file: { name: string; size: number; type: string },
  name: string,
  asset: ResumeAssetPayload
): Promise<Resume> {
  const now = new Date().toISOString();
  const supabase = createAdminClient();

  const { error } = await supabase.from("resumes").insert({
    id,
    owner_id: owner.userId,
    owner_email: owner.email,
    owner_name: owner.name ?? null,
    name,
    source_file_name: file.name,
    file_size: file.size,
    content_type: file.type || "application/pdf",
    content: asset.content,
    parsed_content: JSON.stringify(asset.parsedContent),
    is_verified: true,
    created_at: now,
    updated_at: now,
  });

  if (error) throw error;

  return {
    id,
    name,
    content: asset.content,
    parsedContent: asset.parsedContent,
    isVerified: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    sourceFileName: file.name,
    fileSize: file.size,
    previewUrl: `${Deno.env.get("SUPABASE_URL") ?? ""}/functions/v1/resume-file?id=${id}`,
  };
}

export async function updateResumeMetadata(
  id: string,
  ownerId: string,
  updates: Partial<Pick<Resume, "content" | "parsedContent" | "isVerified">>
): Promise<Resume | null> {
  const current = await getResume(id, ownerId);
  if (!current) return null;

  const supabase = createAdminClient();
  const now = new Date().toISOString();

  const patch: Record<string, unknown> = { updated_at: now };
  if (updates.content !== undefined) patch.content = updates.content;
  if (updates.parsedContent !== undefined)
    patch.parsed_content = JSON.stringify(updates.parsedContent);
  if (updates.isVerified !== undefined) patch.is_verified = updates.isVerified;

  const { error } = await supabase
    .from("resumes")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (error) throw error;

  return {
    ...current,
    ...updates,
    updatedAt: new Date(now),
  };
}

export async function deleteResume(id: string, ownerId: string): Promise<boolean> {
  const current = await getResume(id, ownerId);
  if (!current) return false;

  const supabase = createAdminClient();
  const storagePath = `${ownerId}/${id}`;

  const { error: storageError } = await supabase.storage.from("resumes").remove([storagePath]);
  if (storageError) {
    console.error("deleteResume: storage remove failed", storageError);
    throw storageError;
  }

  const { error } = await supabase.from("resumes").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) throw error;

  return true;
}

export async function getResumeFileInfo(
  id: string,
  ownerId: string
): Promise<{ storagePath: string; fileName: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("resumes")
    .select("source_file_name, owner_id")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error || !data) return null;
  return {
    storagePath: `${ownerId}/${id}`,
    fileName: data.source_file_name as string,
  };
}

export interface TelegramChatLink extends AuthenticatedUserIdentity {
  chatId: number;
  sessionExpiresAt?: string | null;
}

export interface TelegramLoginChallenge {
  chatId: number;
  email: string;
  userId: string;
  phrase?: string | null;
  expiresAt: string;
}

export async function upsertAppUser(identity: AuthenticatedUserIdentity): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("app_users").upsert(
    {
      id: identity.userId,
      email: identity.email,
      name: identity.name ?? null,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (error) throw error;
}

export async function linkTelegramChat(
  chatId: number,
  identity: AuthenticatedUserIdentity
): Promise<void> {
  await upsertAppUser(identity);
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("telegram_chat_links").upsert(
    {
      chat_id: String(chatId),
      user_id: identity.userId,
      email: identity.email,
      name: identity.name ?? null,
      session_expires_at: sessionExpiresAt,
      updated_at: now,
    },
    { onConflict: "chat_id" }
  );
  if (error) throw error;
}

export async function getTelegramChatLink(chatId: number): Promise<TelegramChatLink | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("telegram_chat_links")
    .select("*")
    .eq("chat_id", String(chatId))
    .maybeSingle();

  if (error || !data) return null;
  return {
    chatId: Number(data.chat_id),
    userId: data.user_id as string,
    email: data.email as string,
    name: data.name as string | null,
    sessionExpiresAt: (data.session_expires_at as string | null) ?? null,
  };
}

export async function createTelegramLoginChallenge(
  challenge: TelegramLoginChallenge
): Promise<void> {
  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const { error } = await supabase.from("telegram_login_challenges").upsert(
    {
      chat_id: String(challenge.chatId),
      email: challenge.email,
      user_id: challenge.userId,
      phrase: challenge.phrase ?? null,
      expires_at: challenge.expiresAt,
      created_at: now,
    },
    { onConflict: "chat_id" }
  );
  if (error) throw error;
}

export async function getTelegramLoginChallenge(
  chatId: number
): Promise<TelegramLoginChallenge | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("telegram_login_challenges")
    .select("*")
    .eq("chat_id", String(chatId))
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return {
    chatId: Number(data.chat_id),
    email: data.email as string,
    userId: data.user_id as string,
    phrase: data.phrase as string | null,
    expiresAt: data.expires_at as string,
  };
}

export async function clearTelegramLoginChallenge(chatId: number): Promise<void> {
  const supabase = createAdminClient();
  await supabase.from("telegram_login_challenges").delete().eq("chat_id", String(chatId));
}

const SESSION_TTL_MS = 15 * 24 * 60 * 60 * 1000;

export async function createSession(
  sessionType: string,
  identifier: string,
  ttlMs: number = SESSION_TTL_MS
): Promise<string> {
  const supabase = createAdminClient();
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  const now = new Date().toISOString();

  const { error } = await supabase.from("sessions").upsert(
    {
      session_id: sessionId,
      session_type: sessionType,
      identifier,
      expires_at: expiresAt,
      created_at: now,
    },
    { onConflict: "session_type,identifier" }
  );
  if (error) throw error;
  return sessionId;
}

export async function getSessionByIdentifier(
  sessionType: string,
  identifier: string
): Promise<{ sessionId: string } | null> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sessions")
    .select("session_id")
    .eq("session_type", sessionType)
    .eq("identifier", identifier)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return null;
  return { sessionId: data.session_id as string };
}

export async function deleteSessionByIdentifier(
  sessionType: string,
  identifier: string
): Promise<void> {
  const supabase = createAdminClient();
  await supabase
    .from("sessions")
    .delete()
    .eq("session_type", sessionType)
    .eq("identifier", identifier);
}

export async function isTelegramChatUnlocked(chatId: number): Promise<boolean> {
  const session = await getSessionByIdentifier("telegram", String(chatId));
  return session !== null;
}

export async function setTelegramChatUnlocked(chatId: number): Promise<void> {
  await createSession("telegram", String(chatId));
}

export async function clearTelegramChatSession(chatId: number): Promise<void> {
  await deleteSessionByIdentifier("telegram", String(chatId));
}
