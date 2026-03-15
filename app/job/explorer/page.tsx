"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Search,
  Bookmark,
  RefreshCw,
  MapPin,
  Eye,
  EyeOff,
  ExternalLink,
  Briefcase,
  Loader2,
  MessageCircle,
  Key,
} from "lucide-react";
import { Button } from "@/app/job/search/components/ui/button";
import { ChatBottomSheet } from "@/app/components/chat-bottom-sheet";
import { Card, CardContent } from "@/app/job/search/components/ui/card";
import { Input } from "@/app/job/search/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/app/job/search/components/ui/dialog";
import {
  getJobsApiKey,
  setJobsApiKey,
  removeJobsApiKey,
  validateJobsKey,
  getSavedJobs,
  saveJob,
  removeSavedJob,
  isJobSaved,
  fetchJobsFromApi,
  formatJobDate,
  sortJobs,
  clearJobsCache,
  truncateText,
  type JobListing,
  type JobFilters,
} from "@/app/job/search/lib/jobs-api";
import { cn } from "@/app/job/search/lib/utils";
import { useAppAuth } from "@/app/components/app-auth-provider";
import { sfn } from "@/lib/supabase-api";

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
  const { appFetch } = useAppAuth();
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
  const [resultsSearch, setResultsSearch] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const [notification, setNotification] = useState<{
    message: string;
    type: "success" | "error" | "info";
  } | null>(null);

  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const [jobModalOpen, setJobModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobListing | null>(null);
  const [savedModalOpen, setSavedModalOpen] = useState(false);
  const [addToTrackerLoadingId, setAddToTrackerLoadingId] = useState<string | null>(null);
  const [addToTrackerError, setAddToTrackerError] = useState<string | null>(null);
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const [chatSheetJdText, setChatSheetJdText] = useState<string | null>(null);
  const [chatSheetJobMetadata, setChatSheetJobMetadata] = useState<{
    title?: string;
    company?: string;
    location?: string;
    aboutCompany?: string;
  } | null>(null);

  const [jobsApiKeyInput, setJobsApiKeyInput] = useState("");
  const [showJobsApiKey, setShowJobsApiKey] = useState(false);
  const [jobsApiKeyError, setJobsApiKeyError] = useState("");
  const [jobsSaveMessage, setJobsSaveMessage] = useState("");

  useEffect(() => {
    setJobsApiKeyInput(getJobsApiKey() || "");
  }, []);

  useEffect(() => {
    setSavedCount(getSavedJobs().length);
  }, [jobModalOpen, savedModalOpen]);

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

  const displayedJobs = resultsSearch.trim()
    ? jobs.filter((job) => {
        const q = resultsSearch.toLowerCase();
        const text = [
          job.title,
          job.company,
          job.location,
          job.job_description,
          job.job_type,
          job.experience,
          job.role_and_responsibility ?? "",
          job.education_and_skills ?? "",
          job.about_company ?? "",
        ]
          .join(" ")
          .toLowerCase();
        return q.split(/\s+/).every((term) => text.includes(term));
      })
    : jobs;

  const totalPages = Math.max(1, Math.ceil(displayedJobs.length / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedJobs = displayedJobs.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [resultsSearch, sortBy, location, jobType, experience]);

  const openJobDetail = (job: JobListing) => {
    setSelectedJob(job);
    setJobModalOpen(true);
  };

  const toggleSave = (job: JobListing) => {
    if (isJobSaved(job.id)) {
      removeSavedJob(job.id);
      showNotify("Job removed from saved list", "info");
    } else {
      saveJob(job);
      showNotify("Job saved", "success");
    }
    setSavedCount(getSavedJobs().length);
  };

  const refresh = () => {
    clearJobsCache();
    setCachedJobs([]);
    setLastFilters(null);
    setResultsSearch("");
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

  const savedJobs = getSavedJobs();

  const handleAddToTracker = useCallback(
    async (job: JobListing) => {
      setAddToTrackerError(null);
      setAddToTrackerLoadingId(job.id);
      try {
        const body = {
          title: job.title,
          company: job.company,
          location: job.location,
          role: job.title,
          experience: job.experience ?? "",
          jobType: job.job_type ?? "",
          jdRaw: job.job_description,
          education: job.education_and_skills ?? undefined,
          source: job.apply_link ? `Jobs API (${job.apply_link})` : "Jobs API explorer",
          postedAt: job.posted_date,
          techStack: [] as string[],
        };

        try {
          const resExisting = await appFetch(sfn("jobs", { page: 1, limit: 100 }));
          const dataExisting = await resExisting.json().catch(() => ({}));
          if (Array.isArray((dataExisting as { jobs?: unknown }).jobs)) {
            const existingJobs = (
              dataExisting as {
                jobs: { title: string; company: string; techStack?: string[] }[];
              }
            ).jobs;
            const incomingTitle = job.title.trim().toLowerCase();
            const incomingCompany = job.company.trim().toLowerCase();
            const incomingTech = (body.techStack ?? []).slice().sort();
            const incomingTechKey = incomingTech.join("|").toLowerCase();

            const isDuplicate = existingJobs.some((j) => {
              const titleMatch =
                (j.title ?? "").trim().toLowerCase() === incomingTitle &&
                (j.company ?? "").trim().toLowerCase() === incomingCompany;
              if (!titleMatch) return false;
              const existingTech = (Array.isArray(j.techStack) ? j.techStack : []).slice().sort();
              const existingTechKey = existingTech.join("|").toLowerCase();
              return existingTechKey === incomingTechKey;
            });

            if (isDuplicate) {
              showNotify("Already in tracker (same title, company and tech stack)", "info");
              setAddToTrackerLoadingId(null);
              return;
            }
          }
        } catch {}

        const res = await appFetch(sfn("jobs"), {
          method: "POST",
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));

        if (res.status === 401) {
          setAddToTrackerError("Sign in on the main tracker page before adding jobs.");
          return;
        }

        if (!res.ok) {
          const message =
            (data as { error?: string; detail?: string }).error ??
            (data as { error?: string; detail?: string }).detail ??
            "Failed to add job to tracker";
          setAddToTrackerError(message);
          return;
        }

        showNotify("Job added to tracker", "success");
      } catch {
        setAddToTrackerError("Failed to add job to tracker");
      } finally {
        setAddToTrackerLoadingId(null);
      }
    },
    [appFetch, showNotify]
  );

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
                {displayedJobs.length} job{displayedJobs.length !== 1 ? "s" : ""} found
              </h3>
              <p className="text-sm text-muted-foreground">
                Last updated: {lastFetchTime ? lastFetchTime.toLocaleTimeString() : "Never"}
                {lastFetchTime && <span className="ml-1">({timeAgo(lastFetchTime)})</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
                <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} />
                Refresh
              </Button>
              <Button variant="outline" size="sm" onClick={() => setSavedModalOpen(true)}>
                <Bookmark className="mr-2 h-4 w-4" />
                Saved{savedCount > 0 ? ` (${savedCount})` : ""}
              </Button>
            </div>
          </div>

          {jobs.length > 0 && (
            <div className="flex gap-2 items-center">
              <Input
                placeholder="Search within results..."
                value={resultsSearch}
                onChange={(e) => setResultsSearch(e.target.value)}
                className="max-w-xs"
              />
              {resultsSearch && (
                <span className="text-sm text-muted-foreground">
                  Showing {displayedJobs.length} of {jobs.length}
                </span>
              )}
            </div>
          )}

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

          {!loading && displayedJobs.length === 0 && !error && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Search className="mx-auto h-10 w-10 mb-2 opacity-50" />
                <p className="font-medium">No jobs found</p>
                <p className="text-sm">Try different keywords or filters, or run a search.</p>
              </CardContent>
            </Card>
          )}

          {!loading && displayedJobs.length > 0 && (
            <>
              <div className="flex items-center justify-between text-sm text-muted-foreground">
                <span>
                  Showing{" "}
                  {displayedJobs.length === 0
                    ? 0
                    : `${startIndex + 1}-${Math.min(endIndex, displayedJobs.length)}`}{" "}
                  of {displayedJobs.length} job
                  {displayedJobs.length !== 1 ? "s" : ""}
                </span>
                {totalPages > 1 && (
                  <span>
                    Page {currentPageSafe} of {totalPages}
                  </span>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {paginatedJobs.map((job, index) => (
                  <JobCard
                    key={`${job.id ?? "job"}-${startIndex + index}`}
                    job={job}
                    isSaved={isJobSaved(job.id)}
                    onView={() => openJobDetail(job)}
                    onToggleSave={() => toggleSave(job)}
                    onOpenChat={() => {
                      setChatSheetJdText(job.job_description ?? null);
                      setChatSheetJobMetadata({
                        title: job.title,
                        company: job.company,
                        location: job.location,
                        aboutCompany: job.about_company ?? undefined,
                      });
                      setChatSheetOpen(true);
                    }}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPageSafe === 1}
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {currentPageSafe} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={currentPageSafe === totalPages}
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  >
                    Next
                  </Button>
                </div>
              )}
            </>
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
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          {selectedJob && (
            <>
              <DialogHeader>
                <DialogTitle>{selectedJob.title}</DialogTitle>
                <DialogDescription>{selectedJob.company}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <p>
                  <strong>Location:</strong> {selectedJob.location}
                </p>
                <p>
                  <strong>Job type:</strong> {selectedJob.job_type}
                </p>
                <p>
                  <strong>Experience:</strong> {selectedJob.experience}
                </p>
                <p>
                  <strong>Posted:</strong> {formatJobDate(selectedJob.posted_date)}
                </p>
                {selectedJob.about_company && (
                  <div>
                    <h4 className="font-medium mb-1">About company</h4>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {selectedJob.about_company}
                    </p>
                  </div>
                )}
                <div>
                  <h4 className="font-medium mb-1">Description</h4>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {selectedJob.job_description}
                  </p>
                </div>
                {selectedJob.role_and_responsibility && (
                  <div>
                    <h4 className="font-medium mb-1">Roles & responsibilities</h4>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {selectedJob.role_and_responsibility}
                    </p>
                  </div>
                )}
                {selectedJob.education_and_skills && (
                  <div>
                    <h4 className="font-medium mb-1">Education & skills</h4>
                    <p className="text-muted-foreground whitespace-pre-wrap">
                      {selectedJob.education_and_skills}
                    </p>
                  </div>
                )}
                {addToTrackerError && <p className="text-xs text-red-600">{addToTrackerError}</p>}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setJobModalOpen(false);
                    setChatSheetJdText(selectedJob.job_description ?? null);
                    setChatSheetJobMetadata({
                      title: selectedJob.title,
                      company: selectedJob.company,
                      location: selectedJob.location,
                      aboutCompany: selectedJob.about_company ?? undefined,
                    });
                    setChatSheetOpen(true);
                  }}
                >
                  <MessageCircle className="mr-2 h-4 w-4" />
                  Chat with AI
                </Button>
                <Button
                  variant={isJobSaved(selectedJob.id) ? "secondary" : "default"}
                  onClick={() => toggleSave(selectedJob)}
                >
                  <Bookmark className="mr-2 h-4 w-4" />
                  {isJobSaved(selectedJob.id) ? "Remove from saved" : "Save job"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => handleAddToTracker(selectedJob)}
                  disabled={addToTrackerLoadingId === selectedJob.id}
                >
                  {addToTrackerLoadingId === selectedJob.id ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Briefcase className="mr-2 h-4 w-4" />
                  )}
                  Add to tracker
                </Button>
                {selectedJob.apply_link && (
                  <a href={selectedJob.apply_link} target="_blank" rel="noopener noreferrer">
                    <Button variant="default">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Apply now
                    </Button>
                  </a>
                )}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Saved jobs modal */}
      <Dialog open={savedModalOpen} onOpenChange={setSavedModalOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bookmark className="h-5 w-5" />
              Saved jobs
            </DialogTitle>
          </DialogHeader>
          {savedJobs.length === 0 ? (
            <p className="text-muted-foreground py-4">
              No saved jobs yet. Save jobs from the list to see them here.
            </p>
          ) : (
            <div className="grid gap-2 max-h-[60vh] overflow-y-auto">
              {savedJobs.map((job, index) => (
                <Card
                  key={`${job.id ?? "job"}-${index}`}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => {
                    setSelectedJob(job);
                    setSavedModalOpen(false);
                    setJobModalOpen(true);
                  }}
                >
                  <CardContent className="p-4 flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{job.title}</p>
                      <p className="text-sm text-muted-foreground">
                        {job.company} · {job.location}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        openJobDetail(job);
                        setSavedModalOpen(false);
                      }}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ChatBottomSheet
        open={chatSheetOpen}
        onClose={() => {
          setChatSheetOpen(false);
          setChatSheetJdText(null);
          setChatSheetJobMetadata(null);
        }}
        initialJdText={chatSheetJdText ?? undefined}
        jobMetadata={chatSheetJobMetadata ?? undefined}
      />
    </div>
  );
}

function JobCard({
  job,
  isSaved,
  onView,
  onToggleSave,
  onOpenChat,
}: {
  job: JobListing;
  isSaved: boolean;
  onView: () => void;
  onToggleSave: () => void;
  onOpenChat: () => void;
}) {
  return (
    <Card className="cursor-pointer hover:shadow-md transition-shadow" onClick={onView}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="font-medium text-foreground truncate">{job.title}</h3>
            <p className="text-sm text-muted-foreground truncate">{job.company}</p>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{job.location}</span>
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
            }}
            title={isSaved ? "Remove from saved" : "Save job"}
          >
            <Bookmark className={cn("h-4 w-4", isSaved && "fill-primary text-primary")} />
          </Button>
        </div>
        <div className="flex flex-wrap gap-1 mb-2">
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">
            {job.job_type}
          </span>
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs">
            {job.experience}
          </span>
        </div>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-2">
          {truncateText(job.job_description, 120)}
        </p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Posted {formatJobDate(job.posted_date)}</span>
          <div className="flex flex-col gap-1 items-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onView();
              }}
            >
              <Eye className="mr-1 h-3 w-3" />
              View details
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                onOpenChat();
              }}
            >
              <MessageCircle className="mr-1 h-3 w-3" />
              Chat with AI
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
