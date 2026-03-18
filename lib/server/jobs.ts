import type { AuthenticatedUserIdentity } from "./auth";
import { getSql } from "./neon";
import type { JobRecord, JobStatus, TechStackNormalized } from "@/lib/types";

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
    source: (row.source as string | null) ?? undefined,
    jdRaw: (row.jd_raw as string | null) ?? undefined,
    notes: (row.notes as string | null) ?? undefined,
    createdAt: (row.created_at as string) ?? new Date().toISOString(),
    updatedAt: (row.updated_at as string) ?? new Date().toISOString(),
  };
}

export async function readJobs(ownerId: string): Promise<{ jobs: JobRecord[]; updatedAt: string }> {
  const sql = getSql();
  const rows = (await sql`
    select * from public.jobs
    where owner_id = ${ownerId}
    order by applied_at desc
  `) as Record<string, unknown>[];
  const jobs = rows.map(rowToJobRecord);
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
): Promise<{ jobs: JobRecord[]; total: number; updatedAt: string }> {
  const sql = getSql();
  const offset = Math.max(0, (page - 1) * limit);
  const countRows = (await sql`
    select count(*)::int as total from public.jobs where owner_id = ${ownerId}
  `) as Array<{ total: number }>;
  const total = countRows[0]?.total ?? 0;

  const rows = (await sql`
    select * from public.jobs
    where owner_id = ${ownerId}
    order by applied_at desc
    limit ${limit} offset ${offset}
  `) as Record<string, unknown>[];
  const jobs = rows.map(rowToJobRecord);
  const updatedAt =
    jobs.length > 0
      ? jobs.reduce((latest, j) => (j.updatedAt > latest ? j.updatedAt : latest), jobs[0].updatedAt)
      : new Date().toISOString();
  return { jobs, total, updatedAt };
}

export async function readJobsForDuplicateCheck(
  ownerId: string
): Promise<{ title: string; company: string; techStack: string[] }[]> {
  const sql = getSql();
  const rows = (await sql`
    select title, company, tech_stack
    from public.jobs
    where owner_id = ${ownerId}
    order by applied_at desc
  `) as Array<{ title: string | null; company: string | null; tech_stack: unknown }>;
  return rows.map((r) => ({
    title: r.title ?? "",
    company: r.company ?? "",
    techStack: Array.isArray(r.tech_stack) ? (r.tech_stack as string[]) : [],
  }));
}

export async function getJob(id: string, ownerId: string): Promise<JobRecord | null> {
  const sql = getSql();
  const rows = (await sql`
    select * from public.jobs where id = ${id} and owner_id = ${ownerId} limit 1
  `) as Record<string, unknown>[];
  const row = rows[0];
  return row ? rowToJobRecord(row) : null;
}

export async function addJob(job: JobRecord, owner: AuthenticatedUserIdentity): Promise<JobRecord> {
  const sql = getSql();
  await sql`
    insert into public.jobs (
      id, job_id, owner_id, owner_email, owner_name,
      title, company, company_publisher, location,
      salary_min, salary_max, salary_currency, salary_period, salary_estimated,
      tech_stack, tech_stack_normalized,
      role, experience, job_type, availability, product, seniority, collaboration_tools,
      status, applied_at, posted_at, applicants_count, education,
      source, jd_raw, notes,
      created_at, updated_at
    ) values (
      ${job.id}, ${job.id}, ${owner.userId}, ${owner.email}, ${owner.name ?? null},
      ${job.title}, ${job.company}, ${job.companyPublisher ?? null}, ${job.location},
      ${job.salaryMin ?? null}, ${job.salaryMax ?? null}, ${job.salaryCurrency ?? null}, ${job.salaryPeriod ?? null}, ${job.salaryEstimated ?? false},
      ${job.techStack ?? []}, ${job.techStackNormalized ? JSON.stringify(job.techStackNormalized) : null},
      ${job.role}, ${job.experience}, ${job.jobType ?? null}, ${job.availability ?? null}, ${job.product ?? null}, ${job.seniority ?? null}, ${job.collaborationTools ?? []},
      ${job.status}, ${job.appliedAt}, ${job.postedAt ?? null}, ${job.applicantsCount ?? null}, ${job.education ?? null},
      ${job.source ?? null}, ${job.jdRaw ?? null}, ${job.notes ?? null},
      ${job.createdAt}, ${job.updatedAt}
    )
  `;
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

  const sql = getSql();
  await sql`
    update public.jobs set
      title = ${merged.title},
      company = ${merged.company},
      company_publisher = ${merged.companyPublisher ?? null},
      location = ${merged.location},
      salary_min = ${merged.salaryMin ?? null},
      salary_max = ${merged.salaryMax ?? null},
      salary_currency = ${merged.salaryCurrency ?? null},
      salary_period = ${merged.salaryPeriod ?? null},
      salary_estimated = ${merged.salaryEstimated ?? false},
      tech_stack = ${merged.techStack ?? []},
      tech_stack_normalized = ${merged.techStackNormalized ? JSON.stringify(merged.techStackNormalized) : null},
      role = ${merged.role},
      experience = ${merged.experience},
      job_type = ${merged.jobType ?? null},
      availability = ${merged.availability ?? null},
      product = ${merged.product ?? null},
      seniority = ${merged.seniority ?? null},
      collaboration_tools = ${merged.collaborationTools ?? []},
      status = ${merged.status},
      applied_at = ${merged.appliedAt},
      posted_at = ${merged.postedAt ?? null},
      applicants_count = ${merged.applicantsCount ?? null},
      education = ${merged.education ?? null},
      source = ${merged.source ?? null},
      jd_raw = ${merged.jdRaw ?? null},
      notes = ${merged.notes ?? null},
      updated_at = ${merged.updatedAt}
    where id = ${id} and owner_id = ${ownerId}
  `;
  return merged;
}

export async function deleteJob(id: string, ownerId: string): Promise<boolean> {
  const sql = getSql();
  const result = (await sql`
    delete from public.jobs where id = ${id} and owner_id = ${ownerId}
  `) as unknown;
  // Neon returns an array for selects; for deletes it may return [].
  // We confirm existence by a pre-check like the Edge function.
  return result != null;
}

export async function deleteJobWithCheck(id: string, ownerId: string): Promise<boolean> {
  const existing = await getJob(id, ownerId);
  if (!existing) return false;
  const sql = getSql();
  await sql`delete from public.jobs where id = ${id} and owner_id = ${ownerId}`;
  return true;
}

export async function searchJobsByTitleCompany(
  ownerId: string,
  q: string,
  status?: JobStatus,
  options?: { limit?: number; offset?: number }
): Promise<{ jobs: JobRecord[]; total: number }> {
  const sql = getSql();
  const trimmed = q.trim();
  const limit = Math.min(100, Math.max(1, options?.limit ?? 50));
  const offset = Math.max(0, options?.offset ?? 0);

  if (!trimmed) {
    if (!status) return { jobs: [], total: 0 };
    const rows = (await sql`
      select *, count(*) over()::int as total_count
      from public.jobs
      where owner_id = ${ownerId} and status = ${status}
      order by applied_at desc
      limit ${limit} offset ${offset}
    `) as Array<Record<string, unknown> & { total_count?: number }>;
    const total = rows[0]?.total_count ?? 0;
    return { jobs: rows.map(rowToJobRecord), total };
  }

  try {
    await sql`select set_limit(${0.12})`;
  } catch {
  }

  const qText = trimmed.slice(0, 256);
  const qLang = "english";

  const rows = (await sql`
    with candidates as (
      select
        *,
        greatest(
          similarity(coalesce(title, ''), ${qText}),
          similarity(coalesce(company, ''), ${qText}),
          similarity(coalesce(location, ''), ${qText}),
          similarity(concat_ws(' ', coalesce(title,''), coalesce(company,''), coalesce(location,'')), ${qText})
        ) as score
      from public.jobs
      where owner_id = ${ownerId}
        and (${status ? sql`status = ${status}` : sql`true`})
        and (
          to_tsvector(${qLang}, concat_ws(' ', coalesce(title,''), coalesce(company,''), coalesce(location,'')))
            @@ websearch_to_tsquery(${qLang}, ${qText})
          or title % ${qText}
          or company % ${qText}
          or location % ${qText}
          or concat_ws(' ', coalesce(title,''), coalesce(company,''), coalesce(location,'')) % ${qText}
        )
    )
    select *, count(*) over()::int as total_count
    from candidates
    order by score desc, applied_at desc
    limit ${limit} offset ${offset}
  `) as Array<Record<string, unknown> & { total_count?: number }>;

  const total = rows[0]?.total_count ?? 0;
  return { jobs: rows.map(rowToJobRecord), total };
}

export async function readJobsStats(ownerId: string): Promise<{
  total: number;
  appliedThisWeek: number;
  statusCounts: Record<JobStatus, number>;
}> {
  const sql = getSql();
  const totalRows = (await sql`
    select count(*)::int as total from public.jobs where owner_id = ${ownerId}
  `) as Array<{ total: number }>;
  const total = totalRows[0]?.total ?? 0;

  const appliedRows = (await sql`
    select count(*)::int as total from public.jobs
    where owner_id = ${ownerId} and applied_at >= (now() - interval '7 days')
  `) as Array<{ total: number }>;
  const appliedThisWeek = appliedRows[0]?.total ?? 0;

  const byStatusRows = (await sql`
    select status, count(*)::int as count
    from public.jobs
    where owner_id = ${ownerId}
    group by status
  `) as Array<{ status: JobStatus; count: number }>;

  const statusCounts: Record<JobStatus, number> = {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  };
  for (const r of byStatusRows) {
    if (r.status in statusCounts) statusCounts[r.status] = r.count;
  }

  return { total, appliedThisWeek, statusCounts };
}
