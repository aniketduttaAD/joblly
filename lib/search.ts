import type { JobRecord } from "./types";

export interface SearchOptions {
  limit?: number;
  offset?: number;
  status?: JobRecord["status"];
}

export interface SearchResult {
  jobs: JobRecord[];
  total: number;
}

/**
 * Server-side search filtered to title + company only.
 * Simple case-insensitive substring match — no fuzzy overhead.
 */
export function searchJobs(
  jobs: JobRecord[],
  query: string,
  options: SearchOptions = {}
): SearchResult {
  const { limit, offset = 0, status } = options;

  let list = jobs;
  if (status) {
    list = list.filter((j) => j.status === status);
  }

  const q = (query ?? "").trim().toLowerCase();
  if (!q) {
    const sliced = limit ? list.slice(offset, offset + limit) : list.slice(offset);
    return { jobs: sliced, total: list.length };
  }

  const terms = q.split(/\s+/).filter(Boolean);

  const matched = list.filter((job) => {
    const title = (job.title ?? "").toLowerCase();
    const company = (job.company ?? "").toLowerCase();
    const haystack = `${title} ${company}`;
    return terms.every((term) => haystack.includes(term));
  });

  const sliced = limit ? matched.slice(offset, offset + limit) : matched.slice(offset);
  return { jobs: sliced, total: matched.length };
}
