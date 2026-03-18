// Client-side job data layer — calls Next.js API routes, no Supabase SDK.
import type { JobsData, JobRecord, JobStatus } from "./types";
import { sfn } from "./supabase-api";

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

async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API error ${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
}

export async function readJobs(ownerId: string): Promise<JobsData> {
  return apiFetch<JobsData>(sfn("jobs", { ownerId }));
}

export async function readJobsPaginated(
  ownerId: string,
  page: number,
  limit: number
): Promise<JobsPaginatedResult> {
  return apiFetch<JobsPaginatedResult>(sfn("jobs", { ownerId, page, limit }));
}

export async function readJobsStats(ownerId: string): Promise<JobsStats> {
  return apiFetch<JobsStats>(sfn("jobs-stats", { ownerId }));
}

export async function addJob(
  job: JobRecord,
  _owner: { userId: string; email: string; name?: string | null }
): Promise<JobRecord> {
  return apiFetch<JobRecord>(sfn("jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(job),
  });
}

export async function updateJob(
  id: string,
  _ownerId: string,
  updates: Partial<JobRecord>
): Promise<JobRecord | null> {
  return apiFetch<JobRecord | null>(sfn("jobs-by-id", { id }), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  });
}

export async function getJob(id: string, _ownerId: string): Promise<JobRecord | null> {
  try {
    return await apiFetch<JobRecord>(sfn("jobs-by-id", { id }));
  } catch {
    return null;
  }
}

export async function deleteJob(id: string, _ownerId: string): Promise<boolean> {
  try {
    await apiFetch(sfn("jobs-by-id", { id }), { method: "DELETE" });
    return true;
  } catch {
    return false;
  }
}

export async function deleteJobs(ids: string[], ownerId: string): Promise<number> {
  const results = await Promise.allSettled(ids.map((id) => deleteJob(id, ownerId)));
  return results.filter((r) => r.status === "fulfilled" && r.value).length;
}

export async function searchJobsByTitleCompany(
  _ownerId: string,
  q: string,
  status?: JobStatus
): Promise<{ jobs: JobRecord[]; total: number }> {
  return apiFetch<{ jobs: JobRecord[]; total: number }>(sfn("jobs-search", { q, status }));
}
