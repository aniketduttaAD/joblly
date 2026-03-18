"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, RefreshCw, MapPin, Eye, EyeOff, ExternalLink, Key } from "lucide-react";
import { Button } from "@/app/job/search/components/ui/button";
import { Card, CardContent } from "@/app/job/search/components/ui/card";
import { Input } from "@/app/job/search/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/app/job/search/components/ui/dialog";
import {
  getJobsApiKey,
  setJobsApiKey,
  removeJobsApiKey,
  validateJobsKey,
  fetchJobsFromApi,
  formatJobDate,
  sortJobs,
  clearJobsCache,
  truncateText,
  type JobListing,
  type JobFilters,
} from "@/app/job/search/lib/jobs-api";
import { cn } from "@/app/job/search/lib/utils";

const LOCATIONS = [
  "",
  "Mumbai",
  "Delhi",
  "Bangalore",
  "Hyderabad",
  "Chennai",
  "Pune",
  "Kolkata",
  "Remote",
];
const JOB_TYPES = ["", "Full Time", "Part Time", "Contract", "Internship", "Freelance"];
const EXPERIENCE = ["", "Fresher", "Mid", "Senior", "Executive"];
const SORT_OPTIONS = [
  { value: "relevance", label: "Relevance" },
  { value: "date", label: "Latest First" },
  { value: "date_old", label: "Oldest First" },
];
const POPULAR_KEYWORDS = [
  "Software Engineer",
  "React",
  "Python",
  "Data Scientist",
  "Product Manager",
  "UI/UX",
];

export default function JobsExplorerPage() {
  const [keyword, setKeyword] = useState("");
  const [location, setLocation] = useState("");
  const [jobType, setJobType] = useState("");
  const [experience, setExperience] = useState("");
  const [sortBy, setSortBy] = useState<"relevance" | "date" | "date_old">("relevance");
  const [jobs, setJobs] = useState<JobListing[]>([]);
  const [cachedJobs, setCachedJobs] = useState<JobListing[]>([]);
  const [lastFilters, setLastFilters] = useState<JobFilters | null>(null);
  const [lastFetchTime, setLastFetchTime] = useState<Date | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null);

  const [jobsApiKeyInput, setJobsApiKeyInput] = useState("");
  const [showJobsApiKey, setShowJobsApiKey] = useState(false);
  const [jobsApiKeyError, setJobsApiKeyError] = useState("");
  const [jobsSaveMessage, setJobsSaveMessage] = useState("");

  useEffect(() => {
    setJobsApiKeyInput(getJobsApiKey() || "");
  }, []);

  const handleSaveJobsKey = () => {
    const trimmed = jobsApiKeyInput.trim();
    if (!trimmed) {
      removeJobsApiKey();
      setJobsApiKeyError("");
      setJobsSaveMessage("Jobs API key removed.");
      setTimeout(() => setJobsSaveMessage(""), 3000);
      window.dispatchEvent(new Event("apiKeyUpdated"));
      return;
    }
    if (!validateJobsKey(trimmed)) {
      setJobsApiKeyError("Format: sk-live- followed by 40 characters");
      return;
    }
    setJobsApiKey(trimmed);
    setJobsApiKeyError("");
    setJobsSaveMessage("Jobs API key saved.");
    setTimeout(() => setJobsSaveMessage(""), 3000);
    window.dispatchEvent(new Event("apiKeyUpdated"));
  };

  useEffect(() => {
    if (!notification) return;
    const t = setTimeout(() => setNotification(null), 5000);
    return () => clearTimeout(t);
  }, [notification]);

  const showNotify = useCallback((message: string, type: "success" | "error" | "info") => {
    setNotification({ message, type });
  }, []);

  const getFilters = useCallback(
    (): JobFilters => ({
      ...(keyword.trim() && { title: keyword.trim() }),
      ...(location && { location }),
      ...(jobType && { job_type: jobType }),
      ...(experience && { experience }),
      limit: 100,
    }),
    [keyword, location, jobType, experience]
  );

  const runSearch = useCallback(
    async (forceRefresh = false) => {
      const apiKey = getJobsApiKey();
      if (!apiKey) {
        showNotify("Set your Jobs API key in the app header (Set API Key) to search.", "info");
        return;
      }
      const filters = getFilters();
      if (
        !forceRefresh &&
        cachedJobs.length > 0 &&
        lastFilters &&
        JSON.stringify(filters) === JSON.stringify(lastFilters)
      ) {
        const sorted = sortJobs(cachedJobs, sortBy);
        setJobs(sorted);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await fetchJobsFromApi(filters);
        setCachedJobs(data);
        setLastFilters(filters);
        setLastFetchTime(new Date());
        const sorted = sortJobs(data, sortBy);
        setJobs(sorted);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Search failed");
        setJobs([]);
      } finally {
        setLoading(false);
      }
    },
    [getFilters, sortBy, cachedJobs, lastFilters, showNotify]
  );

  useEffect(() => {
    if (cachedJobs.length > 0 && lastFilters) {
      const sorted = sortJobs(cachedJobs, sortBy);
      setJobs(sorted);
    }
  }, [sortBy, cachedJobs, lastFilters]);

  const openJobDetail = (job: JobListing) => {
    setSelectedJob(job);
    setJobModalOpen(true);
  };

  const refresh = () => {
    clearJobsCache();
    setCachedJobs([]);
    setLastFilters(null);
    runSearch(true);
    showNotify("Jobs refreshed", "success");
  };

  const timeAgo = (date: Date | null) => {
    if (!date) return "";
    const d = Date.now() - date.getTime();
    if (d < 60000) return "just now";
    if (d < 3600000) return `${Math.floor(d / 60000)}m ago`;
    if (d < 86400000) return `${Math.floor(d / 3600000)}h ago`;
    return `${Math.floor(d / 86400000)}d ago`;
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Jobs API Key */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-2 flex items-center gap-2">
            <Key className="h-5 w-5" />
            Jobs API Key
          </h2>
          <p className="text-sm text-muted-foreground mb-4">
            Required to fetch job listings. Get a key at{" "}
            <a
              href="https://indianapi.in/jobs-api"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              indianapi.in/jobs-api
            </a>
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px] max-w-md relative">
              <Input
                type={showJobsApiKey ? "text" : "password"}
                value={jobsApiKeyInput}
                onChange={(e) => {
                  setJobsApiKeyInput(e.target.value);
                  setJobsApiKeyError("");
                  setJobsSaveMessage("");
                }}
                placeholder="sk-live-..."
                className={cn("pr-10", jobsApiKeyError && "border-destructive")}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="absolute right-0 top-0 h-10 w-10"
                onClick={() => setShowJobsApiKey(!showJobsApiKey)}
              >
                {showJobsApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <div className="flex gap-2">
              <Button type="button" variant="default" size="sm" onClick={handleSaveJobsKey}>
                {jobsApiKeyInput.trim() ? "Save key" : "Remove key"}
              </Button>
              {getJobsApiKey() && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    removeJobsApiKey();
                    setJobsApiKeyInput("");
                    setJobsApiKeyError("");
                    window.dispatchEvent(new Event("apiKeyUpdated"));
                  }}
                >
                  Clear
                </Button>
              )}
            </div>
          </div>
          {jobsApiKeyError && <p className="text-sm text-destructive mt-2">{jobsApiKeyError}</p>}
          {!jobsApiKeyError && jobsSaveMessage && (
            <p className="text-sm text-green-600 mt-2">{jobsSaveMessage}</p>
          )}
          <p className="text-xs text-muted-foreground mt-2">
            Format: sk-live- followed by 40 characters. Key is stored in this browser only.
          </p>
        </section>

        {/* Search */}
        <section className="rounded-xl border border-border bg-card p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Search and apply to latest jobs
          </h2>
          <div className="flex flex-wrap gap-3 items-center mb-4">
            <div className="flex-1 min-w-[200px] relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Job title, skills, or company..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runSearch()}
                className="pl-9"
              />
            </div>
            <Button onClick={() => runSearch()} disabled={loading}>
              <Search className="mr-2 h-4 w-4" />
              {loading ? "Searching…" : "Search"}
            </Button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Location</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              >
                <option value="">Any</option>
                {LOCATIONS.filter(Boolean).map((loc) => (
                  <option key={loc} value={loc}>
                    {loc}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Job type</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={jobType}
                onChange={(e) => setJobType(e.target.value)}
              >
                <option value="">All</option>
                {JOB_TYPES.filter(Boolean).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Experience</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
              >
                <option value="">All</option>
                {EXPERIENCE.filter(Boolean).map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sort</label>
              <select
                className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as "relevance" | "date" | "date_old")}
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted-foreground">Popular:</span>
            {POPULAR_KEYWORDS.map((kw) => (
              <Button
                key={kw}
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => {
                  setKeyword(kw);
                  runSearch();
                }}
              >
                {kw}
              </Button>
            ))}
          </div>
        </section>

        {/* Results */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-medium text-foreground">
                {jobs.length} job{jobs.length !== 1 ? "s" : ""} found
              </h3>
              <p className="text-sm text-muted-foreground">
                Last updated: {lastFetchTime ? lastFetchTime.toLocaleTimeString() : "Never"}
                {lastFetchTime && <span className="ml-1">({timeAgo(lastFetchTime)})</span>}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
              Refresh
            </Button>
          </div>

          {error && (
            <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 flex items-center gap-2 text-destructive">
              <span>{error}</span>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-2">
              <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Searching for jobs…</p>
            </div>
          )}

          {!loading && jobs.length === 0 && !error && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Search className="mx-auto h-10 w-10 mb-2 opacity-50" />
                <p className="font-medium">No jobs found</p>
                <p className="text-sm">Try different keywords or filters, or run a search.</p>
              </CardContent>
            </Card>
          )}

          {!loading && jobs.length > 0 && (
            <div className="space-y-2">
              {jobs.map((job, index) => (
                <JobCard
                  key={`${job.id ?? "job"}-${index}`}
                  job={job}
                  onView={() => openJobDetail(job)}
                />
              ))}
            </div>
          )}
        </section>

        {/* Toast */}
        {notification && (
          <div
            className={cn(
              "fixed top-4 right-4 z-[100] rounded-lg border px-4 py-2 shadow-lg text-sm",
              notification.type === "success" && "border-green-500/50 bg-green-50 text-green-800",
              notification.type === "error" && "border-red-500/50 bg-red-50 text-red-800",
              notification.type === "info" && "border-blue-500/50 bg-blue-50 text-blue-800"
            )}
          >
            {notification.message}
          </div>
        )}
      </div>

      {/* Job detail modal */}
      <Dialog open={jobModalOpen} onOpenChange={setJobModalOpen}>
        <DialogContent className="max-w-2xl w-full p-0 overflow-hidden rounded-2xl">
          {selectedJob && (
            <div className="flex max-h-[80vh] flex-col bg-beige-50">
              <div className="flex-1 overflow-y-auto overscroll-contain p-6 space-y-4 text-sm">
                <DialogHeader className="px-0">
                  <DialogTitle className="text-lg font-semibold text-stone-800">
                    {selectedJob.title}
                  </DialogTitle>
                  <DialogDescription className="text-sm text-stone-600">
                    {selectedJob.company}
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-1 text-xs text-stone-600">
                  <p className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    <span>{selectedJob.location}</span>
                  </p>
                  <p>
                    {selectedJob.job_type && <span>{selectedJob.job_type}</span>}
                    {selectedJob.experience && selectedJob.job_type && <span> · </span>}
                    {selectedJob.experience && <span>{selectedJob.experience}</span>}
                  </p>
                  <p>Posted {formatJobDate(selectedJob.posted_date)}</p>
                </div>
                {selectedJob.about_company && (
                  <div>
                    <h4 className="mb-1 text-sm font-semibold text-stone-800">About company</h4>
                    <p className="text-sm text-stone-700 whitespace-pre-wrap">
                      {selectedJob.about_company}
                    </p>
                  </div>
                )}
                <div>
                  <h4 className="mb-1 text-sm font-semibold text-stone-800">Description</h4>
                  <p className="text-sm text-stone-700 whitespace-pre-wrap">
                    {selectedJob.job_description}
                  </p>
                </div>
                {selectedJob.role_and_responsibility && (
                  <div>
                    <h4 className="mb-1 text-sm font-semibold text-stone-800">
                      Roles & responsibilities
                    </h4>
                    <p className="text-sm text-stone-700 whitespace-pre-wrap">
                      {selectedJob.role_and_responsibility}
                    </p>
                  </div>
                )}
                {selectedJob.education_and_skills && (
                  <div>
                    <h4 className="mb-1 text-sm font-semibold text-stone-800">
                      Education & skills
                    </h4>
                    <p className="text-sm text-stone-700 whitespace-pre-wrap">
                      {selectedJob.education_and_skills}
                    </p>
                  </div>
                )}
              </div>
              {selectedJob.apply_link && (
                <div className="flex shrink-0 items-center justify-end gap-3 border-t border-beige-300 bg-beige-50 px-4 py-3 sm:px-6 sm:py-4">
                  <a
                    href={selectedJob.apply_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto"
                  >
                    <Button className="w-full min-w-[160px]">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Apply now
                    </Button>
                  </a>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function JobCard({ job, onView }: { job: JobListing; onView: () => void }) {
  return (
    <Card
      className="cursor-pointer rounded-xl border border-beige-300 bg-white hover:shadow-md transition-shadow"
      onClick={onView}
    >
      <CardContent className="p-5 flex items-center justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="mb-2">
            <h3 className="font-semibold text-base md:text-lg text-stone-800 leading-tight truncate">
              {job.title}
            </h3>
            <p className="text-sm md:text-base text-stone-600 truncate">{job.company}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs md:text-sm text-stone-600">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-4 w-4 shrink-0 text-stone-500" />
              <span className="truncate max-w-[200px] sm:max-w-[260px]">{job.location}</span>
            </span>
            {job.job_type && (
              <span className="inline-flex items-center rounded-full bg-beige-100 px-3 py-0.5 text-[11px] md:text-xs">
                {job.job_type}
              </span>
            )}
            {job.experience && (
              <span className="inline-flex items-center rounded-full bg-beige-100 px-3 py-0.5 text-[11px] md:text-xs">
                {job.experience}
              </span>
            )}
          </div>
          {job.job_description && (
            <p className="mt-2 text-xs md:text-sm text-stone-700 line-clamp-2">
              {truncateText(job.job_description, 160)}
            </p>
          )}
          <p className="mt-2 text-[11px] md:text-xs text-stone-500">
            Posted {formatJobDate(job.posted_date)}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-9 md:h-10 px-3 md:px-4 text-xs md:text-sm shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onView();
          }}
        >
          <Eye className="mr-2 h-4 w-4" />
          View
        </Button>
      </CardContent>
    </Card>
  );
}
