import type { JobsData, JobRecord, JobStatus, TechStackNormalized } from "./types";
import { createClient } from "@supabase/supabase-js";

interface StoredJobRow {
  ownerId: string;
  ownerEmail: string;
  ownerName: string | null;
  jobId: string;
  title: string;
  company: string;
  companyPublisher: string | null;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: string | null;
  salaryEstimated: boolean;
  techStack: string[];
  techStackNormalized: string | null;
  role: string;
  experience: string;
  jobType: string | null;
  availability: string | null;
  product: string | null;
  seniority: string | null;
  collaborationTools: string[];
  status: string;
  appliedAt: string;
  postedAt: string | null;
  applicantsCount: number | null;
  education: string | null;
  source: string | null;
  jdRaw: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

function createSupabaseClient() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ?? "").trim();
  if (!url || !anonKey) {
    throw new Error("Supabase is not configured for storage operations.");
  }
  return createClient(url, anonKey, { auth: { persistSession: false } });
}

function toStoredJobRow(
  job: JobRecord,
  owner: { userId: string; email: string; name?: string | null }
): StoredJobRow {
  return {
    ownerId: owner.userId,
    ownerEmail: owner.email,
    ownerName: owner.name ?? null,
    jobId: job.id,
    title: job.title,
    company: job.company,
    companyPublisher: job.companyPublisher ?? null,
    location: job.location,
    salaryMin: job.salaryMin ?? null,
    salaryMax: job.salaryMax ?? null,
    salaryCurrency: job.salaryCurrency ?? null,
    salaryPeriod: job.salaryPeriod ?? null,
    salaryEstimated: job.salaryEstimated ?? false,
    techStack: job.techStack,
    techStackNormalized: job.techStackNormalized ? JSON.stringify(job.techStackNormalized) : null,
    role: job.role,
    experience: job.experience,
    jobType: job.jobType ?? null,
    availability: job.availability ?? null,
    product: job.product ?? null,
    seniority: job.seniority ?? null,
    collaborationTools: job.collaborationTools ?? [],
    status: job.status,
    appliedAt: job.appliedAt,
    postedAt: job.postedAt ?? null,
    applicantsCount: job.applicantsCount ?? null,
    education: job.education ?? null,
    source: job.source ?? null,
    jdRaw: job.jdRaw ?? null,
    notes: job.notes ?? null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function fromStoredJobRow(row: StoredJobRow & { id: string }): JobRecord {
  const d = row;
  const parsedTechStackNormalized: TechStackNormalized | null = d.techStackNormalized
    ? (JSON.parse(d.techStackNormalized) as TechStackNormalized)
    : null;
  return {
    id: d.jobId || d.id,
    title: d.title ?? "",
    company: d.company ?? "",
    companyPublisher: d.companyPublisher ?? null,
    location: d.location ?? "",
    salaryMin: d.salaryMin ?? null,
    salaryMax: d.salaryMax ?? null,
    salaryCurrency: d.salaryCurrency ?? null,
    salaryPeriod:
      d.salaryPeriod === "hourly" || d.salaryPeriod === "monthly" || d.salaryPeriod === "yearly"
        ? d.salaryPeriod
        : undefined,
    salaryEstimated: d.salaryEstimated ?? false,
    techStack: Array.isArray(d.techStack) ? d.techStack : [],
    techStackNormalized: parsedTechStackNormalized,
    role: d.role ?? "",
    experience: d.experience ?? "Not specified",
    jobType: d.jobType ?? null,
    availability: d.availability ?? null,
    product: d.product ?? null,
    seniority: d.seniority ?? null,
    collaborationTools: Array.isArray(d.collaborationTools) ? d.collaborationTools : [],
    status: (d.status ?? "applied") as JobRecord["status"],
    appliedAt: d.appliedAt ?? new Date().toISOString(),
    postedAt: d.postedAt ?? null,
    applicantsCount: d.applicantsCount ?? null,
    education: d.education ?? null,
    source: d.source ?? undefined,
    jdRaw: d.jdRaw ?? undefined,
    notes: d.notes ?? undefined,
    createdAt: d.createdAt ?? new Date().toISOString(),
    updatedAt: d.updatedAt ?? new Date().toISOString(),
  };
}

export async function readJobs(ownerId: string): Promise<JobsData> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false });

  if (error) {
    throw error;
  }

  const jobs = (data ?? []).map((row) =>
    fromStoredJobRow({
      ...row,
      id: (row as any).id as string,
      jobId: (row as any).job_id ?? row.jobId,
      ownerId: (row as any).owner_id ?? row.ownerId,
      ownerEmail: (row as any).owner_email ?? row.ownerEmail,
      ownerName: (row as any).owner_name ?? row.ownerName,
      salaryMin: (row as any).salary_min ?? row.salaryMin,
      salaryMax: (row as any).salary_max ?? row.salaryMax,
      salaryCurrency: (row as any).salary_currency ?? row.salaryCurrency,
      salaryPeriod: (row as any).salary_period ?? row.salaryPeriod,
      salaryEstimated: (row as any).salary_estimated ?? row.salaryEstimated,
      techStack: (row as any).tech_stack ?? row.techStack,
      techStackNormalized: (row as any).tech_stack_normalized ?? row.techStackNormalized,
      jobType: (row as any).job_type ?? row.jobType,
      applicantsCount: (row as any).applicants_count ?? row.applicantsCount,
      createdAt: (row as any).created_at ?? row.createdAt,
      updatedAt: (row as any).updated_at ?? row.updatedAt,
    })
  );
  const updatedAt =
    jobs.length > 0
      ? jobs.reduce((latest, j) => (j.updatedAt > latest ? j.updatedAt : latest), jobs[0].updatedAt)
      : new Date().toISOString();
  return { jobs, updatedAt };
}

export interface JobsPaginatedResult {
  jobs: JobRecord[];
  total: number;
  updatedAt: string;
}

export async function readJobsPaginated(
  ownerId: string,
  page: number,
  limit: number
): Promise<JobsPaginatedResult> {
  const offset = Math.max(0, (page - 1) * limit);
  const supabase = createSupabaseClient();
  const { data, error, count } = await supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .order("applied_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const jobs = rows.map((row) =>
    fromStoredJobRow({
      ...row,
      id: (row as any).id as string,
      jobId: (row as any).job_id ?? row.jobId,
      ownerId: (row as any).owner_id ?? row.ownerId,
      ownerEmail: (row as any).owner_email ?? row.ownerEmail,
      ownerName: (row as any).owner_name ?? row.ownerName,
      salaryMin: (row as any).salary_min ?? row.salaryMin,
      salaryMax: (row as any).salary_max ?? row.salaryMax,
      salaryCurrency: (row as any).salary_currency ?? row.salaryCurrency,
      salaryPeriod: (row as any).salary_period ?? row.salaryPeriod,
      salaryEstimated: (row as any).salary_estimated ?? row.salaryEstimated,
      techStack: (row as any).tech_stack ?? row.techStack,
      techStackNormalized: (row as any).tech_stack_normalized ?? row.techStackNormalized,
      jobType: (row as any).job_type ?? row.jobType,
      applicantsCount: (row as any).applicants_count ?? row.applicantsCount,
      createdAt: (row as any).created_at ?? row.createdAt,
      updatedAt: (row as any).updated_at ?? row.updatedAt,
    })
  );
  const updatedAt =
    jobs.length > 0
      ? jobs.reduce<string>(
          (latest, j) => (j.updatedAt > latest ? j.updatedAt : latest),
          jobs[0].updatedAt
        )
      : new Date().toISOString();
  return { jobs, total: count ?? jobs.length, updatedAt };
}

export interface JobsStats {
  total: number;
  appliedThisWeek: number;
  statusCounts: Record<JobStatus, number>;
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
    statusCounts[job.status] += 1;
  }
  return { total: jobs.length, appliedThisWeek, statusCounts };
}

export async function addJob(
  job: JobRecord,
  owner: { userId: string; email: string; name?: string | null }
): Promise<JobRecord> {
  const supabase = createSupabaseClient();
  const row = toStoredJobRow(job, owner);
  const { error } = await supabase.from("jobs").insert({
    id: job.id,
    job_id: row.jobId,
    owner_id: row.ownerId,
    owner_email: row.ownerEmail,
    owner_name: row.ownerName,
    title: row.title,
    company: row.company,
    company_publisher: row.companyPublisher,
    location: row.location,
    salary_min: row.salaryMin,
    salary_max: row.salaryMax,
    salary_currency: row.salaryCurrency,
    salary_period: row.salaryPeriod,
    salary_estimated: row.salaryEstimated,
    tech_stack: row.techStack,
    tech_stack_normalized: row.techStackNormalized,
    role: row.role,
    experience: row.experience,
    job_type: row.jobType,
    availability: row.availability,
    product: row.product,
    seniority: row.seniority,
    collaboration_tools: row.collaborationTools,
    status: row.status,
    applied_at: row.appliedAt,
    posted_at: row.postedAt,
    applicants_count: row.applicantsCount,
    education: row.education,
    source: row.source,
    jd_raw: row.jdRaw,
    notes: row.notes,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  });

  if (error) {
    throw error;
  }

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

  const supabase = createSupabaseClient();
  const row = toStoredJobRow(merged, {
    userId: ownerId,
    email: "",
    name: undefined,
  });
  const { error } = await supabase
    .from("jobs")
    .update({
      job_id: row.jobId,
      title: row.title,
      company: row.company,
      company_publisher: row.companyPublisher,
      location: row.location,
      salary_min: row.salaryMin,
      salary_max: row.salaryMax,
      salary_currency: row.salaryCurrency,
      salary_period: row.salaryPeriod,
      salary_estimated: row.salaryEstimated,
      tech_stack: row.techStack,
      tech_stack_normalized: row.techStackNormalized,
      role: row.role,
      experience: row.experience,
      job_type: row.jobType,
      availability: row.availability,
      product: row.product,
      seniority: row.seniority,
      collaboration_tools: row.collaborationTools,
      status: row.status,
      applied_at: row.appliedAt,
      posted_at: row.postedAt,
      applicants_count: row.applicantsCount,
      education: row.education,
      source: row.source,
      jd_raw: row.jdRaw,
      notes: row.notes,
      updated_at: row.updatedAt,
    })
    .eq("id", id)
    .eq("owner_id", ownerId);

  if (error) {
    throw error;
  }

  return merged;
}

export async function getJob(id: string, ownerId: string): Promise<JobRecord | null> {
  const supabase = createSupabaseClient();
  const { data, error } = await supabase
    .from("jobs")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();

  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  if (!data) return null;

  return fromStoredJobRow({
    ...data,
    id: (data as any).id as string,
    jobId: (data as any).job_id ?? data.jobId,
    ownerId: (data as any).owner_id ?? data.ownerId,
    ownerEmail: (data as any).owner_email ?? data.ownerEmail,
    ownerName: (data as any).owner_name ?? data.ownerName,
    salaryMin: (data as any).salary_min ?? data.salaryMin,
    salaryMax: (data as any).salary_max ?? data.salaryMax,
    salaryCurrency: (data as any).salary_currency ?? data.salaryCurrency,
    salaryPeriod: (data as any).salary_period ?? data.salaryPeriod,
    salaryEstimated: (data as any).salary_estimated ?? data.salaryEstimated,
    techStack: (data as any).tech_stack ?? data.techStack,
    techStackNormalized: (data as any).tech_stack_normalized ?? data.techStackNormalized,
    jobType: (data as any).job_type ?? data.jobType,
    applicantsCount: (data as any).applicants_count ?? data.applicantsCount,
    createdAt: (data as any).created_at ?? data.createdAt,
    updatedAt: (data as any).updated_at ?? data.updatedAt,
  });
}

export async function deleteJob(id: string, ownerId: string): Promise<boolean> {
  const job = await getJob(id, ownerId);
  if (!job) return false;
  const supabase = createSupabaseClient();
  const { error } = await supabase.from("jobs").delete().eq("id", id).eq("owner_id", ownerId);
  if (error) {
    throw error;
  }
  return true;
}

export async function deleteJobs(ids: string[], ownerId: string): Promise<number> {
  if (ids.length === 0) return 0;
  const supabase = createSupabaseClient();
  const { error, count } = await supabase
    .from("jobs")
    .delete({ count: "exact" })
    .in("id", ids)
    .eq("owner_id", ownerId);

  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function searchJobsByTitleCompany(
  ownerId: string,
  q: string,
  status?: JobStatus
): Promise<{ jobs: JobRecord[]; total: number }> {
  const trimmed = q.trim();
  if (!trimmed) return { jobs: [], total: 0 };

  const supabase = createSupabaseClient();
  let query = supabase
    .from("jobs")
    .select("*", { count: "exact" })
    .eq("owner_id", ownerId)
    .ilike("title", `%${trimmed}%`)
    .order("applied_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error, count } = await query;
  if (error) {
    throw error;
  }

  const rows = data ?? [];
  const jobs = rows.map((row) =>
    fromStoredJobRow({
      ...row,
      id: (row as any).id as string,
      jobId: (row as any).job_id ?? row.jobId,
      ownerId: (row as any).owner_id ?? row.ownerId,
      ownerEmail: (row as any).owner_email ?? row.ownerEmail,
      ownerName: (row as any).owner_name ?? row.ownerName,
      salaryMin: (row as any).salary_min ?? row.salaryMin,
      salaryMax: (row as any).salary_max ?? row.salaryMax,
      salaryCurrency: (row as any).salary_currency ?? row.salaryCurrency,
      salaryPeriod: (row as any).salary_period ?? row.salaryPeriod,
      salaryEstimated: (row as any).salary_estimated ?? row.salaryEstimated,
      techStack: (row as any).tech_stack ?? row.techStack,
      techStackNormalized: (row as any).tech_stack_normalized ?? row.techStackNormalized,
      jobType: (row as any).job_type ?? row.jobType,
      applicantsCount: (row as any).applicants_count ?? row.applicantsCount,
      createdAt: (row as any).created_at ?? row.createdAt,
      updatedAt: (row as any).updated_at ?? row.updatedAt,
    })
  );

  return { jobs, total: count ?? jobs.length };
}
