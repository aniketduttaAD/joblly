"use client";

import { sfn } from "@/lib/supabase-api";

const JOBS_API_KEY_STORAGE = "jobs_api_key";
const SAVED_JOBS_STORAGE = "saved_jobs";
const CACHE_PREFIX = "job_cache_";
const CACHE_EXPIRY_MS = 10 * 60 * 1000;
const JOBS_PROXY_PATH = sfn("jobs-external");

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  job_type: string;
  experience: string;
  job_description: string;
  about_company?: string;
  role_and_responsibility?: string;
  education_and_skills?: string;
  posted_date: string;
  apply_link?: string;
  savedAt?: string;
}

export interface JobFilters {
  title?: string;
  location?: string;
  job_type?: string;
  experience?: string;
  limit?: number;
}

function cacheKey(filters: JobFilters): string {
  const str = JSON.stringify(filters);
  return CACHE_PREFIX + btoa(str).replace(/[^a-zA-Z0-9]/g, "");
}

function getCached(key: string): JobListing[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function setCache(key: string, data: JobListing[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, expiry: Date.now() + CACHE_EXPIRY_MS }));
  } catch {
    /* ignore */
  }
}

export function getJobsApiKey(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(JOBS_API_KEY_STORAGE);
}

export function setJobsApiKey(key: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(JOBS_API_KEY_STORAGE, key);
}

export function removeJobsApiKey(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(JOBS_API_KEY_STORAGE);
}

export function validateJobsKey(key: string): boolean {
  return /^sk-live-[a-zA-Z0-9]{40}$/.test(key.trim());
}

export function getSavedJobs(): JobListing[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(SAVED_JOBS_STORAGE);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveJob(job: JobListing): void {
  const saved = getSavedJobs();
  if (saved.some((j) => j.id === job.id)) return;
  saved.push({ ...job, savedAt: new Date().toISOString() });
  localStorage.setItem(SAVED_JOBS_STORAGE, JSON.stringify(saved));
}

export function removeSavedJob(jobId: string): void {
  const saved = getSavedJobs().filter((j) => j.id !== jobId);
  localStorage.setItem(SAVED_JOBS_STORAGE, JSON.stringify(saved));
}

export function isJobSaved(jobId: string): boolean {
  return getSavedJobs().some((j) => j.id === jobId);
}

export function formatJobDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const diffDays = Math.ceil(Math.abs(now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 1) return "Today";
    if (diffDays === 2) return "Yesterday";
    if (diffDays <= 7) return `${diffDays - 1} days ago`;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Unknown date";
  }
}

export function sortJobs(
  jobs: JobListing[],
  sortBy: "relevance" | "date" | "date_old"
): JobListing[] {
  const copy = [...jobs];
  if (sortBy === "date") {
    copy.sort((a, b) => new Date(b.posted_date).getTime() - new Date(a.posted_date).getTime());
  } else if (sortBy === "date_old") {
    copy.sort((a, b) => new Date(a.posted_date).getTime() - new Date(b.posted_date).getTime());
  }
  return copy;
}

export function clearJobsCache(): void {
  if (typeof window === "undefined") return;
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (key.startsWith(CACHE_PREFIX)) localStorage.removeItem(key);
  });
}

export async function fetchJobsFromApi(filters: JobFilters): Promise<JobListing[]> {
  const apiKey = getJobsApiKey();
  if (!apiKey) throw new Error("API key not found. Please add your Jobs API key in Settings.");

  const key = cacheKey(filters);
  const cached = getCached(key);
  if (cached) return cached;

  const params = new URLSearchParams();
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.location) params.set("location", filters.location);
  if (filters.title) params.set("title", filters.title);
  if (filters.experience) params.set("experience", filters.experience);
  if (filters.job_type) params.set("job_type", filters.job_type);

  const url = `${JOBS_PROXY_PATH}?${params.toString()}`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "X-Api-Key": apiKey,
      "Content-Type": "application/json",
    },
  });

  const responseData = await res.json().catch(() => ({}));

  if (!res.ok) {
    const detail =
      Array.isArray((responseData as { detail?: unknown }).detail) &&
      (responseData as { detail: Array<{ msg?: string }> }).detail.length > 0
        ? (responseData as { detail: Array<{ msg?: string }> }).detail
            .map((d) => d.msg)
            .filter(Boolean)
            .join("; ")
        : undefined;
    const message = detail || (responseData as { error?: string }).error || "Search failed";
    if (res.status === 401) throw new Error("Invalid API key. Please check your key in Settings.");
    if (res.status === 429) throw new Error("Rate limit exceeded. Try again later.");
    throw new Error(message);
  }

  const data = Array.isArray(responseData) ? responseData : [];
  setCache(key, data);
  return data as JobListing[];
}

export function truncateText(text: string, max = 150): string {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max) + "...";
}
