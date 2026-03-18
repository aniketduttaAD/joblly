"use client";

import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  Search,
  Plus,
  Trash2,
  Briefcase,
  Code,
  Loader2,
  FileText,
  X,
  Check,
  Eye,
  Copy,
  Download,
  Upload,
  MessageCircle,
} from "lucide-react";
import type { JobRecord, JobStatus } from "@/lib/types";
import { useAppAuth } from "@/app/components/app-auth-provider";
import { ChatBottomSheet } from "@/app/components/chat-bottom-sheet";
import { sfn } from "@/lib/supabase-api";

const JOB_STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "interview", label: "Interview" },
  { value: "offer", label: "Offer" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export default function HomePage() {
  const { appFetch, authRequired, authenticated, ready } = useAppAuth();

  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [totalJobsCount, setTotalJobsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [searchStatus, setSearchStatus] = useState<JobStatus | "">("");
  const [searchedJobs, setSearchedJobs] = useState<JobRecord[] | null>(null);
  const [searchedTotal, setSearchedTotal] = useState<number>(0);
  const [searchLoading, setSearchLoading] = useState(false);
  const [stats, setStats] = useState<{
    total: number;
    appliedThisWeek: number;
    statusCounts: Record<JobStatus, number>;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [parseModalOpen, setParseModalOpen] = useState(false);
  const [parsePaste, setParsePaste] = useState("");
  const [parseLoading, setParseLoading] = useState(false);
  const [parseResult, setParseResult] = useState<Record<string, unknown> | null>(null);
  const [editedParseJson, setEditedParseJson] = useState<string>("");
  const [editedFields, setEditedFields] = useState<Partial<JobRecord> | null>(null);
  const [showJsonEditor, setShowJsonEditor] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState<string | "bulk" | null>(null);

  const [detailJob, setDetailJob] = useState<JobRecord | null>(null);
  const [patchJobLoading, setPatchJobLoading] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<{
    phase: "fetching_db" | "parsing" | "checking" | "importing" | "done";
    total: number;
    valid: number;
    processed: number;
    created: number;
    skippedDuplicate: number;
    skippedInvalid: number;
    skippedInFileDuplicate: number;
    failed: number;
    currentTitle?: string;
    currentCompany?: string;
    error?: string;
  } | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [chatSheetOpen, setChatSheetOpen] = useState(false);
  const [chatSheetJdText, setChatSheetJdText] = useState<string | null>(null);
  const [chatSheetJobMetadata, setChatSheetJobMetadata] = useState<{
    title?: string;
    company?: string;
    location?: string;
    companyPublisher?: string;
  } | null>(null);

  const PAGE_SIZE = 20;
  const [currentPage, setCurrentPage] = useState(1);

  const fetchJobs = useCallback(
    async (page: number = 1) => {
      setLoading(true);
      setLoadError(null);
      try {
        const params = new URLSearchParams();
        params.set("page", String(page));
        params.set("limit", String(PAGE_SIZE));
        const controller = new AbortController();
        const timeoutId = window.setTimeout(() => controller.abort(), 20_000);
        const res = await appFetch(`${sfn("jobs")}?${params.toString()}`, {
          signal: controller.signal,
        }).finally(() => window.clearTimeout(timeoutId));
        const data = await res.json().catch(() => ({}));
        if (res.status === 401) {
          return;
        }
        setJobs(Array.isArray(data.jobs) ? data.jobs : []);
        setTotalJobsCount(typeof data.total === "number" ? data.total : (data.jobs?.length ?? 0));
      } catch (e) {
        setLoadError(
          e instanceof Error && e.name === "AbortError"
            ? "Request timed out. Please refresh and try again."
            : e instanceof Error
              ? e.message
              : "Failed to load jobs."
        );
      } finally {
        setLoading(false);
      }
    },
    [appFetch]
  );

  const fetchStats = useCallback(async () => {
    try {
      const res = await appFetch(sfn("jobs-stats"));
      const data = await res.json().catch(() => ({}));
      if (res.ok && data) {
        setStats({
          total: data.total ?? 0,
          appliedThisWeek: data.appliedThisWeek ?? 0,
          statusCounts: data.statusCounts ?? {
            applied: 0,
            screening: 0,
            interview: 0,
            offer: 0,
            rejected: 0,
            withdrawn: 0,
          },
        });
      }
    } catch {}
  }, [appFetch]);

  useEffect(() => {
    if (!ready) return;
    if (authRequired && !authenticated) return;
    void fetchStats();
  }, [authRequired, authenticated, fetchStats, ready]);

  useEffect(() => {
    if (!ready) return;
    if (authRequired && !authenticated) return;
    void fetchJobs(currentPage);
  }, [authRequired, authenticated, fetchJobs, currentPage, ready]);

  const SEARCH_DEBOUNCE_MS = 400;

  useEffect(() => {
    const q = search.trim();
    const statusFilter = searchStatus || undefined;
    if (!q && !statusFilter) {
      setSearchedJobs(null);
      setSearchedTotal(0);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      const runSearch = async () => {
        try {
          const limit = PAGE_SIZE;
          const offset = Math.max(0, (currentPage - 1) * PAGE_SIZE);
          const params = new URLSearchParams();
          if (q) params.set("q", q);
          if (statusFilter) params.set("status", statusFilter);
          params.set("limit", String(limit));
          params.set("offset", String(offset));

          const res = await appFetch(`${sfn("jobs-search")}?${params.toString()}`);
          const data = await res.json().catch(() => ({}));
          if (cancelled) return;
          if (!res.ok) {
            setSearchedJobs(null);
            setSearchedTotal(0);
            return;
          }
          const jobsArr = Array.isArray((data as { jobs?: unknown }).jobs)
            ? ((data as { jobs: JobRecord[] }).jobs as JobRecord[])
            : [];
          const total =
            typeof (data as { total?: unknown }).total === "number"
              ? (data as { total: number }).total
              : jobsArr.length;
          setSearchedJobs(jobsArr);
          setSearchedTotal(total);
        } catch {
          if (!cancelled) {
            setSearchedJobs(null);
            setSearchedTotal(0);
          }
        } finally {
          if (!cancelled) setSearchLoading(false);
        }
      };

      void runSearch();
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [PAGE_SIZE, appFetch, currentPage, search, searchStatus]);

  const useServerPagination = !search.trim() && !searchStatus;
  const baseJobs = searchedJobs !== null ? searchedJobs : jobs;

  const totalPages = useServerPagination
    ? Math.max(1, Math.ceil(totalJobsCount / PAGE_SIZE))
    : Math.max(1, Math.ceil((searchedJobs !== null ? searchedTotal : baseJobs.length) / PAGE_SIZE));
  const currentPageSafe = Math.min(currentPage, totalPages);
  const startIndex = (currentPageSafe - 1) * PAGE_SIZE;
  const endIndex = startIndex + PAGE_SIZE;
  const paginatedJobs = useServerPagination ? jobs : baseJobs;

  useEffect(() => {
    setCurrentPage(1);
  }, [search, searchStatus]);

  const totalJobs = stats?.total ?? totalJobsCount;
  const appliedThisWeek = stats?.appliedThisWeek ?? 0;
  const statusCounts = stats?.statusCounts ?? {
    applied: 0,
    screening: 0,
    interview: 0,
    offer: 0,
    rejected: 0,
    withdrawn: 0,
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === baseJobs.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(baseJobs.map((j) => j.id)));
  };

  const handleDeleteOne = async (id: string) => {
    setDeleteLoading(id);
    try {
      const res = await appFetch(sfn("jobs-by-id", { id }), {
        method: "DELETE",
      });
      if (res.ok) {
        setJobs((prev) => prev.filter((j) => j.id !== id));
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
        if (detailJob?.id === id) setDetailJob(null);
        void fetchJobs(currentPage);
        void fetchStats();
      }
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setDeleteLoading("bulk");
    try {
      const res = await appFetch(sfn("jobs-bulk"), {
        method: "DELETE",
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.deleted) {
        setJobs((prev) => prev.filter((j) => !selectedIds.has(j.id)));
        setSelectedIds(new Set());
        if (detailJob && selectedIds.has(detailJob.id)) setDetailJob(null);
        void fetchJobs(currentPage);
        void fetchStats();
      }
    } finally {
      setDeleteLoading(null);
    }
  };

  const handleParse = async () => {
    if (!parsePaste.trim()) return;

    setParseLoading(true);
    setParseResult(null);
    try {
      const res = await appFetch(sfn("jobs-parse"), {
        method: "POST",
        body: JSON.stringify({ jd: parsePaste.trim() }),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        if (data.error === "Authentication required" || data.error === "Unauthorized") {
          setParseResult({ error: "Session expired. Please sign in again." });
        } else {
          setParseResult({ error: data.error ?? "Authentication failed" });
        }
      } else if (res.ok) {
        setParseResult(data);
        const record = (data?.record ?? data?.parsed ?? {}) as Partial<JobRecord>;
        setEditedFields({
          ...record,
          techStack: Array.isArray(record.techStack) ? record.techStack : [],
          techStackNormalized: (record.techStackNormalized ??
            null) as JobRecord["techStackNormalized"],
          collaborationTools: (record.collaborationTools ??
            null) as JobRecord["collaborationTools"],
        });
        setEditedParseJson(JSON.stringify(data, null, 2));
        setShowJsonEditor(false);
      } else {
        setParseResult({ error: data.error ?? "Parse failed" });
        setEditedParseJson("");
      }
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Parse error:", error);
      }
      setParseResult({ error: "Request failed. Please try again." });
    } finally {
      setParseLoading(false);
    }
  };

  const handleCopyAll = async () => {
    let jsonToCopy: string;
    if (editedFields) {
      jsonToCopy = JSON.stringify(editedFields, null, 2);
    } else if (editedParseJson) {
      jsonToCopy = editedParseJson;
    } else {
      jsonToCopy = JSON.stringify(parseResult?.parsed ?? parseResult?.record, null, 2);
    }

    try {
      await navigator.clipboard.writeText(jsonToCopy);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      const textArea = document.createElement("textarea");
      textArea.value = jsonToCopy;
      document.body.appendChild(textArea);
      textArea.select();
      try {
        document.execCommand("copy");
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch {}
      document.body.removeChild(textArea);
    }
  };

  const updateField = (field: keyof JobRecord, value: unknown) => {
    if (!editedFields) return;
    setEditedFields({ ...editedFields, [field]: value });
  };

  const handleSaveParsed = async () => {
    let record: Partial<JobRecord> | undefined;

    if (editedFields) {
      record = editedFields;
    } else if (editedParseJson.trim()) {
      try {
        const parsed = JSON.parse(editedParseJson);
        if (parsed.record) {
          record = parsed.record as Partial<JobRecord>;
        } else if (parsed.parsed) {
          record = parsed.parsed as Partial<JobRecord>;
        } else {
          record = parsed as Partial<JobRecord>;
        }
      } catch (parseError) {
        setParseResult((prev) =>
          prev
            ? { ...prev, error: "Invalid JSON. Please check your edits." }
            : { error: "Invalid JSON. Please check your edits." }
        );
        return;
      }
    } else {
      record = parseResult?.record as Partial<JobRecord> | undefined;
    }

    if (!record) {
      setParseResult((prev) =>
        prev ? { ...prev, error: "No data to save" } : { error: "No data to save" }
      );
      return;
    }
    if (record.title && record.company) {
      const key = `${record.title.trim().toLowerCase()}::${record.company.trim().toLowerCase()}`;
      const existingKeys = new Set(
        jobs
          .filter((j) => j.title && j.company)
          .map((j) => `${j.title.trim().toLowerCase()}::${j.company.trim().toLowerCase()}`)
      );
      if (
        existingKeys.has(key) &&
        !window.confirm(
          "A job with the same title and company already exists in the tracker. Do you still want to add this job?"
        )
      ) {
        return;
      }
    }
    setSaveLoading(true);
    try {
      const authedRes = await appFetch(sfn("jobs"), {
        method: "POST",
        body: JSON.stringify(record),
      });
      const data = await authedRes.json().catch(() => ({}));
      if (authedRes.ok) {
        const created = data as JobRecord;
        setJobs((prev) => [created, ...prev]);
        setTotalJobsCount((prev) => prev + 1);
        setStats((prev) =>
          prev
            ? {
                ...prev,
                total: prev.total + 1,
                statusCounts: {
                  ...prev.statusCounts,
                  [created.status]: (prev.statusCounts[created.status] ?? 0) + 1,
                },
              }
            : prev
        );
        setParseModalOpen(false);
        setParsePaste("");
        setParseResult(null);
        setEditedParseJson("");
        setEditedFields(null);
        setShowJsonEditor(false);
      } else {
        const msg = [data.error, data.detail].filter(Boolean).join(" — ");
        setParseResult((prev) =>
          prev ? { ...prev, error: msg || "Unable to save" } : { error: msg || "Unable to save" }
        );
      }
    } catch {
      setParseResult((prev) =>
        prev ? { ...prev, error: "Unable to save" } : { error: "Unable to save" }
      );
    } finally {
      setSaveLoading(false);
    }
  };

  const fetchAllJobsForExport = async (): Promise<JobRecord[] | null> => {
    try {
      const res = await appFetch(sfn("jobs-bulk"));
      const data = (await res.json().catch(() => ({}))) as {
        jobs?: JobRecord[];
        count?: number;
        error?: string;
      };
      if (!res.ok || !Array.isArray(data.jobs)) {
        const message = data.error || "Failed to fetch jobs for export";
        alert(message);
        return null;
      }
      return data.jobs;
    } catch {
      alert("Failed to fetch jobs for export");
      return null;
    }
  };

  const handleExportJSON = async () => {
    const exportedAt = new Date().toISOString();
    const allJobs = await fetchAllJobsForExport();
    if (!allJobs) return;

    const payload = {
      exportedAt,
      count: allJobs.length,
      jobs: allJobs,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobs-export-${exportedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const csvEscape = (value: unknown) => {
    const s = value == null ? "" : String(value);
    if (/[",\n]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const handleExportCSV = async () => {
    const allJobs = await fetchAllJobsForExport();
    if (!allJobs) return;

    const header = [
      "title",
      "company",
      "location",
      "role",
      "experience",
      "jobType",
      "status",
      "appliedAt",
      "postedAt",
      "source",
    ];
    const lines = [
      header.join(","),
      ...allJobs.map((job) =>
        [
          job.title,
          job.company,
          job.location,
          job.role,
          job.experience,
          job.jobType ?? "",
          job.status,
          job.appliedAt,
          job.postedAt ?? "",
          job.source ?? "",
        ]
          .map(csvEscape)
          .join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `jobs-export-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleClickImport = () => {
    if (authRequired && !authenticated) {
      alert("Sign in first before importing jobs.");
      return;
    }
    importInputRef.current?.click();
  };

  const parseImportedJSON = (text: string): Partial<JobRecord>[] => {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) return parsed as Partial<JobRecord>[];
    if (parsed && Array.isArray((parsed as { jobs?: unknown }).jobs)) {
      return (parsed as { jobs: Partial<JobRecord>[] }).jobs;
    }
    return [];
  };

  const handleImportFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    const progress: {
      phase: "fetching_db" | "parsing" | "checking" | "importing" | "done";
      total: number;
      valid: number;
      processed: number;
      created: number;
      skippedDuplicate: number;
      skippedInvalid: number;
      skippedInFileDuplicate: number;
      failed: number;
      currentTitle?: string;
      currentCompany?: string;
      error?: string;
    } = {
      phase: "parsing",
      total: 0,
      valid: 0,
      processed: 0,
      created: 0,
      skippedDuplicate: 0,
      skippedInvalid: 0,
      skippedInFileDuplicate: 0,
      failed: 0,
    };

    try {
      setImportLoading(true);

      if (!file.name.toLowerCase().endsWith(".json")) {
        setImportProgress({
          ...progress,
          phase: "done",
          error: "Import supports JSON files only.",
        });
        return;
      }

      setImportProgress({ ...progress, phase: "parsing" });
      const text = await file.text();
      let records: Partial<JobRecord>[] = [];
      try {
        records = parseImportedJSON(text);
      } catch {
        setImportProgress({
          ...progress,
          phase: "done",
          error: "Invalid JSON file. Could not parse.",
        });
        return;
      }

      progress.total = records.length;
      if (!records.length) {
        setImportProgress({ ...progress, phase: "done", error: "No jobs found in the file." });
        return;
      }

      setImportProgress({ ...progress, phase: "fetching_db" });

      let dbJobs: JobRecord[] = jobs;
      try {
        const res = await appFetch(`${sfn("jobs")}?all=1`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.jobs)) {
          dbJobs = data.jobs as JobRecord[];
        }
      } catch {}

      setImportProgress({ ...progress, phase: "checking" });

      const existingKeys = new Set(
        dbJobs
          .filter((j) => j.title && j.company)
          .map((j) => `${j.title.trim().toLowerCase()}::${j.company.trim().toLowerCase()}`)
      );
      const seenInFile = new Set<string>();

      const validRecords: Partial<JobRecord>[] = [];
      for (let i = 0; i < records.length; i++) {
        const r = records[i];
        const hasTitle = typeof r?.title === "string" && r.title.trim().length > 0;
        const hasCompany = typeof r?.company === "string" && r.company.trim().length > 0;
        if (!hasTitle || !hasCompany) {
          progress.skippedInvalid += 1;
          continue;
        }
        const key = `${r.title!.trim().toLowerCase()}::${r.company!.trim().toLowerCase()}`;
        if (existingKeys.has(key)) {
          progress.skippedDuplicate += 1;
          continue;
        }
        if (seenInFile.has(key)) {
          progress.skippedInFileDuplicate += 1;
          continue;
        }
        seenInFile.add(key);
        validRecords.push(r);
      }

      progress.valid = validRecords.length;
      if (!validRecords.length) {
        setImportProgress({ ...progress, phase: "done" });
        return;
      }

      setImportProgress({ ...progress, phase: "importing" });

      const createdJobs: JobRecord[] = [];
      for (let i = 0; i < validRecords.length; i++) {
        const raw = validRecords[i];
        progress.processed = i;
        progress.currentTitle = String(raw.title ?? "");
        progress.currentCompany = String(raw.company ?? "");
        setImportProgress({ ...progress, phase: "importing" });

        try {
          const res = await appFetch(sfn("jobs"), {
            method: "POST",
            body: JSON.stringify(raw),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            progress.failed += 1;
          } else {
            progress.created += 1;
            createdJobs.push(data as JobRecord);
          }
        } catch {
          progress.failed += 1;
        }

        progress.processed = i + 1;
        setImportProgress({ ...progress, phase: "importing" });
      }

      progress.currentTitle = undefined;
      progress.currentCompany = undefined;

      if (createdJobs.length > 0) {
        void fetchJobs(1);
        void fetchStats();
      }

      setImportProgress({ ...progress, phase: "done" });
    } catch (error) {
      setImportProgress({
        ...progress,
        phase: "done",
        error: error instanceof Error ? error.message : "Import failed due to an unexpected error.",
      });
    } finally {
      setImportLoading(false);
    }
  };

  const formatSalary = (job: JobRecord) => {
    const { salaryMin, salaryMax, salaryCurrency, salaryPeriod, salaryEstimated } = job;
    const period = salaryPeriod || "yearly";
    const curr = (salaryCurrency || "").trim();
    const isINRLakhs =
      (curr === "INR" || (!curr && salaryMin != null && salaryMin >= 100_000)) &&
      period === "yearly" &&
      (salaryMin == null || salaryMin >= 100_000) &&
      (salaryMax == null || salaryMax >= 100_000);
    const toLPA = (n: number) => (n / 100_000).toFixed(n % 100_000 === 0 ? 0 : 1);
    let salaryStr = "";
    if (salaryMin != null && salaryMax != null) {
      if (isINRLakhs)
        salaryStr = `${curr ? curr + " " : ""}${toLPA(salaryMin)} - ${toLPA(salaryMax)} LPA`;
      else
        salaryStr = `${curr ? curr + " " : ""}${salaryMin.toLocaleString()} - ${salaryMax.toLocaleString()}/${period}`;
    } else if (salaryMin != null) {
      if (isINRLakhs) salaryStr = `${curr ? curr + " " : ""}${toLPA(salaryMin)}+ LPA`;
      else salaryStr = `${curr ? curr + " " : ""}${salaryMin.toLocaleString()}+/${period}`;
    } else if (salaryMax != null) {
      if (isINRLakhs) salaryStr = `${curr ? curr + " " : ""}up to ${toLPA(salaryMax)} LPA`;
      else salaryStr = `${curr ? curr + " " : ""}up to ${salaryMax.toLocaleString()}/${period}`;
    } else {
      return "—";
    }
    return salaryEstimated ? `${salaryStr} (estimated)` : salaryStr;
  };

  const emptyToDash = (s: string | null | undefined) =>
    s != null && String(s).trim() !== "" ? String(s).trim() : "—";

  const formatPostedAt = (postedAt: string | null | undefined) => {
    if (postedAt == null) return null;
    const s = String(postedAt).trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      try {
        return new Date(s + "T00:00:00Z").toLocaleDateString();
      } catch {
        return s;
      }
    }
    return s;
  };

  const formatAppliedAt = (appliedAt: string | null | undefined) => {
    if (!appliedAt?.trim()) return null;
    const s = appliedAt.trim();
    try {
      const d = new Date(s);
      if (Number.isNaN(d.getTime())) return s;
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return s;
    }
  };

  const handlePatchJob = useCallback(
    async (id: string, patch: { status?: JobStatus; appliedAt?: string }) => {
      if (authRequired && !authenticated) return;
      setPatchJobLoading(true);
      try {
        const res = await appFetch(sfn("jobs-by-id", { id }), {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        if (!res.ok) return;
        const updated = (await res.json()) as JobRecord;
        setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
        if (detailJob?.id === id) {
          setDetailJob(updated);
        }
      } finally {
        setPatchJobLoading(false);
      }
    },
    [appFetch, authRequired, authenticated, detailJob?.id]
  );

  useEffect(() => {
    if (!detailJob) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDetailJob(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [detailJob]);

  if (!ready) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col">
      {/* Toolbar under global header: search + page actions only */}
      <div className="sticky top-14 z-20 border-b border-beige-300 bg-beige-50/95 backdrop-blur supports-[backdrop-filter]:bg-beige-50/90">
        <div className="mx-auto max-w-6xl px-4 py-3 sm:px-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
            <div className="relative min-w-0 flex-1">
              {searchLoading ? (
                <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 shrink-0 animate-spin text-stone-400 pointer-events-none" />
              ) : (
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 shrink-0 text-stone-400 pointer-events-none" />
              )}
              <input
                type="text"
                placeholder="Search: title or company"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-lg border border-beige-300 bg-white py-2.5 pl-9 pr-10 text-sm text-stone-800 placeholder-stone-400 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
              />
              {(search.trim() || searchStatus) && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setSearchStatus("");
                    setSearchedJobs(null);
                    setSearchLoading(false);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <select
              value={searchStatus}
              onChange={(e) => setSearchStatus((e.target.value || "") as JobStatus | "")}
              className="min-h-[44px] rounded-lg border border-beige-300 bg-white px-3 py-2.5 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
              title="Filter by status"
            >
              <option value="">All statuses</option>
              {JOB_STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={() => setExportModalOpen(true)}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-beige-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
              >
                <Download className="h-4 w-4 shrink-0" />
                Export
              </button>
              <button
                type="button"
                onClick={() => setImportModalOpen(true)}
                disabled={importLoading}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-beige-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20 disabled:opacity-60"
              >
                {importLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 shrink-0" />
                )}
                Import
              </button>
              <button
                type="button"
                onClick={() => {
                  if (authRequired && !authenticated) return;
                  setParseModalOpen(true);
                  setParsePaste("");
                  setParseResult(null);
                }}
                disabled={authRequired === true && !authenticated}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg bg-orange-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-dark focus:outline-none focus:ring-2 focus:ring-orange-brand/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Plus className="h-4 w-4 shrink-0" />
                Add from JD
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <div className="mx-auto max-w-6xl">
          {/* Dashboard summary */}
          <section className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-xl border border-beige-300 bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Total jobs
              </p>
              <p className="mt-1 text-2xl font-semibold text-stone-800">{totalJobs}</p>
            </div>
            <div className="rounded-xl border border-beige-300 bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                Applied this week
              </p>
              <p className="mt-1 text-2xl font-semibold text-stone-800">{appliedThisWeek}</p>
            </div>
            <div className="rounded-xl border border-beige-300 bg-white px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">
                By status
              </p>
              <div className="mt-1 flex flex-wrap gap-2 text-xs text-stone-700">
                {JOB_STATUS_OPTIONS.map((opt) => (
                  <span
                    key={opt.value}
                    className="inline-flex items-center gap-1 rounded-full bg-beige-100 px-2 py-0.5"
                  >
                    <span className="capitalize">{opt.label}</span>
                    <span className="font-semibold">{statusCounts[opt.value]}</span>
                  </span>
                ))}
              </div>
            </div>
          </section>

          {selectedIds.size > 0 && (
            <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-orange-brand/30 bg-orange-brand/10 px-4 py-3 sm:px-5">
              <span className="text-sm font-medium text-stone-700">
                {selectedIds.size} selected
              </span>
              <button
                type="button"
                onClick={selectAll}
                className="text-sm text-orange-dark underline hover:no-underline"
              >
                {selectedIds.size === baseJobs.length ? "Deselect all" : "Select all"}
              </button>
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={deleteLoading === "bulk"}
                className="ml-2 inline-flex items-center gap-1 rounded bg-red-600 px-2 py-1 text-sm text-white hover:bg-red-700 disabled:opacity-50"
              >
                {deleteLoading === "bulk" ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
                Delete selected
              </button>
            </div>
          )}

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-orange-brand" aria-hidden />
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-6 py-10 text-center sm:px-10">
              <p className="text-sm font-medium text-red-700">Unable to load jobs</p>
              <p className="mt-2 text-sm text-red-700/90">{loadError}</p>
              <button
                type="button"
                onClick={() => void fetchJobs(currentPage)}
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-lg bg-orange-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-dark focus:outline-none focus:ring-2 focus:ring-orange-brand/30"
              >
                Retry
              </button>
            </div>
          ) : baseJobs.length === 0 ? (
            <div className="rounded-xl border border-beige-300 bg-beige-100/50 px-6 py-20 text-center sm:px-10 sm:py-24">
              <Briefcase className="mx-auto h-14 w-14 text-beige-400" aria-hidden />
              <p className="mt-4 text-base font-medium text-stone-600 sm:text-lg">No jobs yet</p>
              <p className="mt-2 text-sm text-stone-500">
                Add a job from a JD or import from a file.
              </p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between pb-2 text-sm text-stone-500">
                <span>
                  Showing{" "}
                  {paginatedJobs.length === 0
                    ? 0
                    : `${startIndex + 1}-${startIndex + paginatedJobs.length}`}{" "}
                  of {useServerPagination ? totalJobsCount : baseJobs.length} job
                  {(useServerPagination ? totalJobsCount : baseJobs.length) !== 1 ? "s" : ""}
                </span>
                {totalJobs > 0 && (
                  <span>
                    Total saved: {totalJobs} job
                    {totalJobs !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
              <ul className="space-y-5 sm:space-y-6">
                {paginatedJobs.map((job, index) => (
                  <li
                    key={`${job.id ?? "job"}-${startIndex + index}`}
                    className="rounded-xl border border-beige-300 bg-white p-5 shadow-sm transition hover:shadow-md sm:p-6"
                  >
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                      <div className="min-w-0 flex-1 space-y-3">
                        <div className="flex flex-wrap items-start gap-3">
                          <label className="flex shrink-0 cursor-pointer items-center gap-2.5">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(job.id)}
                              onChange={() => toggleSelect(job.id)}
                              className="h-4 w-4 rounded border-beige-300 text-orange-brand focus:ring-2 focus:ring-orange-brand/20"
                            />
                            <h2 className="font-semibold text-stone-800 leading-tight">
                              {emptyToDash(job.title)}
                            </h2>
                          </label>
                        </div>
                        <p className="text-sm text-stone-600">
                          {emptyToDash(job.company)}
                          {job.companyPublisher ? ` (${job.companyPublisher})` : ""}
                        </p>
                        <p className="text-sm text-stone-500">{emptyToDash(job.location)}</p>
                        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-stone-600">
                          {job.role && (
                            <span>
                              <span className="font-medium text-stone-500">Role:</span>{" "}
                              {emptyToDash(job.role)}
                            </span>
                          )}
                          {job.seniority && (
                            <span>
                              <span className="font-medium text-stone-500">Seniority:</span>{" "}
                              {emptyToDash(job.seniority)}
                            </span>
                          )}
                          {job.experience && (
                            <span>
                              <span className="font-medium text-stone-500">Experience:</span>{" "}
                              {emptyToDash(job.experience)}
                            </span>
                          )}
                          {job.jobType && (
                            <span>
                              <span className="font-medium text-stone-500">Type:</span>{" "}
                              {emptyToDash(job.jobType)}
                            </span>
                          )}
                          {job.availability && (
                            <span>
                              <span className="font-medium text-stone-500">Availability:</span>{" "}
                              {emptyToDash(job.availability)}
                            </span>
                          )}
                          {job.product && (
                            <span>
                              <span className="font-medium text-stone-500">Product:</span>{" "}
                              {emptyToDash(job.product)}
                            </span>
                          )}
                          {!job.role &&
                            !job.seniority &&
                            !job.experience &&
                            !job.jobType &&
                            !job.availability &&
                            !job.product && <span className="text-stone-400">—</span>}
                        </div>
                        <p className="text-sm font-medium text-stone-700">{formatSalary(job)}</p>
                        {job.techStack.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {job.techStack.slice(0, 8).map((t) => (
                              <span
                                key={t}
                                className="inline-flex items-center gap-0.5 rounded-md bg-beige-200 px-2 py-0.5 text-xs text-stone-600"
                              >
                                <Code className="h-3 w-3 shrink-0" />
                                {t}
                              </span>
                            ))}
                            {job.techStack.length > 8 && (
                              <span className="text-xs text-stone-400">
                                +{job.techStack.length - 8}
                              </span>
                            )}
                          </div>
                        )}
                        {(job.postedAt ||
                          job.education ||
                          (job.collaborationTools?.length ?? 0) > 0) && (
                          <p className="text-xs text-stone-500">
                            {[
                              job.postedAt && `Posted ${formatPostedAt(job.postedAt)}`,
                              job.education &&
                                `Education: ${job.education.slice(0, 50)}${(job.education?.length ?? 0) > 50 ? "…" : ""}`,
                              (job.collaborationTools?.length ?? 0) > 0 &&
                                `Tools: ${job.collaborationTools!.slice(0, 3).join(", ")}${(job.collaborationTools!.length ?? 0) > 3 ? "…" : ""}`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        )}
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-700">
                          <span className="font-semibold uppercase tracking-wide text-[10px] text-stone-500">
                            Status:
                          </span>
                          <span
                            className="inline-flex rounded-md bg-beige-200 px-2 py-0.5 font-medium capitalize text-stone-700"
                            title="Application status"
                          >
                            {job.status}
                          </span>
                          {job.appliedAt && (
                            <span className="text-stone-500">
                              · Applied {formatAppliedAt(job.appliedAt)}
                            </span>
                          )}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-700">
                          <span className="font-semibold uppercase tracking-wide text-[10px] text-stone-500">
                            Update status:
                          </span>
                          {JOB_STATUS_OPTIONS.map((opt) => (
                            <button
                              key={opt.value}
                              type="button"
                              onClick={() =>
                                handlePatchJob(job.id, {
                                  status: opt.value,
                                })
                              }
                              disabled={patchJobLoading || job.status === opt.value}
                              className={`inline-flex items-center rounded-md border px-3 py-1 capitalize text-xs font-medium transition-colors ${
                                job.status === opt.value
                                  ? "border-orange-brand bg-orange-brand text-white cursor-default"
                                  : "border-beige-300 bg-white hover:bg-beige-100"
                              }`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 border-t border-beige-200 pt-4 sm:border-t-0 sm:pt-0 sm:pl-4">
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailJob(job)}
                            className="inline-flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-beige-300 bg-beige-100 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-beige-200 focus:outline-none focus:ring-2 focus:ring-orange-brand/20 sm:flex-initial"
                            title="View full details"
                          >
                            <Eye className="h-4 w-4 shrink-0" />
                            View details
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setChatSheetJdText(job.jdRaw ?? null);
                              setChatSheetJobMetadata({
                                title: job.title,
                                company: job.company,
                                location: job.location,
                                companyPublisher: job.companyPublisher ?? undefined,
                              });
                              setChatSheetOpen(true);
                            }}
                            className="inline-flex min-h-[44px] min-w-[44px] flex-1 items-center justify-center gap-2 rounded-lg border border-beige-300 bg-beige-100 px-4 py-2.5 text-sm font-medium text-stone-700 hover:bg-beige-200 focus:outline-none focus:ring-2 focus:ring-orange-brand/20 sm:flex-initial"
                            title="Chat with AI"
                          >
                            <MessageCircle className="h-4 w-4 shrink-0" />
                            Chat with AI
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteOne(job.id)}
                          disabled={deleteLoading === job.id}
                          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg p-2 text-stone-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-500/20 disabled:opacity-50"
                          title="Delete"
                        >
                          {deleteLoading === job.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </button>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-center gap-3">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPageSafe === 1}
                    className="rounded border border-beige-300 px-3 py-1 text-sm text-stone-700 disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="text-xs text-stone-500">
                    Page {currentPageSafe} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                    disabled={currentPageSafe === totalPages}
                    className="rounded border border-beige-300 px-3 py-1 text-sm text-stone-700 disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {detailJob && (
        <div
          className="fixed inset-0 z-30 flex items-end justify-center sm:items-center sm:p-4"
          onClick={() => setDetailJob(null)}
          role="dialog"
          aria-modal="true"
          aria-labelledby="detail-modal-title"
        >
          <div
            className="absolute inset-0 bg-stone-900/60 backdrop-blur-[2px] transition-opacity"
            aria-hidden
          />

          <div
            className="relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-beige-300 border-b-0 bg-beige-50 shadow-2xl sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl sm:border-b"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-2 border-b border-beige-300 bg-beige-50/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
              <h2
                id="detail-modal-title"
                className="text-lg font-semibold text-stone-800 sm:text-xl"
              >
                Job details
              </h2>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDetailJob(null)}
                  className="-mr-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-stone-500 hover:bg-beige-200 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
              <div className="space-y-6">
                <section>
                  <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                    Overview
                  </h3>
                  <h4 className="text-lg font-semibold text-stone-800 leading-tight">
                    {emptyToDash(detailJob.title)}
                  </h4>
                  <p className="mt-1 text-sm text-stone-600">
                    {emptyToDash(detailJob.company)}
                    {detailJob.companyPublisher ? ` (${detailJob.companyPublisher})` : ""}
                  </p>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                    Details
                  </h3>
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        Location
                      </dt>
                      <dd className="text-sm font-medium text-stone-800">
                        {emptyToDash(detailJob.location)}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        Status
                      </dt>
                      <dd className="text-sm font-medium capitalize text-stone-800">
                        {detailJob.status}
                      </dd>
                    </div>
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        Applied
                      </dt>
                      <dd className="text-sm text-stone-800">
                        {formatAppliedAt(detailJob.appliedAt) ?? "—"}
                      </dd>
                    </div>
                    {detailJob.role && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Role
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.role}</dd>
                      </div>
                    )}
                    {detailJob.experience && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Experience
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.experience}</dd>
                      </div>
                    )}
                    {detailJob.jobType && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Type
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.jobType}</dd>
                      </div>
                    )}
                    {detailJob.availability && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Availability
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.availability}</dd>
                      </div>
                    )}
                    <div className="space-y-0.5">
                      <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                        Salary
                      </dt>
                      <dd className="text-sm font-medium text-stone-800">
                        {formatSalary(detailJob)}
                      </dd>
                    </div>
                    {detailJob.product && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Product
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.product}</dd>
                      </div>
                    )}
                    {detailJob.seniority && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Seniority
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.seniority}</dd>
                      </div>
                    )}
                    {detailJob.postedAt && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Posted
                        </dt>
                        <dd className="text-sm text-stone-800">
                          {formatPostedAt(detailJob.postedAt)}
                        </dd>
                      </div>
                    )}
                    {detailJob.education && (
                      <div className="space-y-0.5 sm:col-span-2">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Education
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.education}</dd>
                      </div>
                    )}
                    {detailJob.source && (
                      <div className="space-y-0.5">
                        <dt className="text-xs font-medium uppercase tracking-wide text-stone-500">
                          Source
                        </dt>
                        <dd className="text-sm text-stone-800">{detailJob.source}</dd>
                      </div>
                    )}
                  </dl>
                </section>

                <section>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                    Update status
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-stone-700">
                    <span className="font-semibold uppercase tracking-[0.14em] text-stone-500">
                      Status:
                    </span>
                    <span
                      className="inline-flex rounded-md bg-beige-200 px-2 py-0.5 font-medium capitalize text-stone-700"
                      title="Application status"
                    >
                      {detailJob.status}
                    </span>
                    {detailJob.appliedAt && (
                      <span className="text-stone-500">
                        · Applied {formatAppliedAt(detailJob.appliedAt)}
                      </span>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-stone-700">
                    <span className="font-semibold uppercase tracking-wide text-[10px] text-stone-500">
                      Update status:
                    </span>
                    {JOB_STATUS_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() =>
                          handlePatchJob(detailJob.id, {
                            status: opt.value,
                          })
                        }
                        disabled={patchJobLoading || detailJob.status === opt.value}
                        className={`inline-flex items-center rounded-md border px-3 py-1 capitalize text-xs font-medium transition-colors ${
                          detailJob.status === opt.value
                            ? "border-orange-brand bg-orange-brand text-white cursor-default"
                            : "border-beige-300 bg-white hover:bg-beige-100"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </section>

                {(detailJob.collaborationTools?.length ?? 0) > 0 && (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                      Collaboration tools
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {detailJob.collaborationTools!.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center rounded-lg bg-beige-200/80 px-2.5 py-1 text-xs font-medium text-stone-700"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {detailJob.techStack.length > 0 && (
                  <section>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-500">
                      Tech stack
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {detailJob.techStack.map((t) => (
                        <span
                          key={t}
                          className="inline-flex items-center gap-1 rounded-lg bg-beige-200 px-2.5 py-1 text-xs font-medium text-stone-700"
                        >
                          <Code className="h-3.5 w-3.5 shrink-0" />
                          {t}
                        </span>
                      ))}
                    </div>
                  </section>
                )}

                {detailJob.notes && (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                      Notes
                    </h3>
                    <p className="rounded-lg bg-beige-100/80 p-3 text-sm text-stone-800 whitespace-pre-wrap">
                      {detailJob.notes}
                    </p>
                  </section>
                )}

                {detailJob.jdRaw && (
                  <section>
                    <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-500">
                      Full job description
                    </h3>
                    <div className="max-h-64 overflow-y-auto rounded-lg border border-beige-300 bg-beige-100/80 p-4 text-xs leading-relaxed text-stone-700 whitespace-pre-wrap scrollbar-thin">
                      {detailJob.jdRaw}
                    </div>
                  </section>
                )}
              </div>
            </div>

            <div className="sticky bottom-0 flex shrink-0 justify-end gap-2 border-t border-beige-300 bg-beige-50/95 px-4 py-3 backdrop-blur sm:px-6 sm:py-4">
              <button
                type="button"
                onClick={() => {
                  setDetailJob(null);
                  setChatSheetJdText(detailJob?.jdRaw ?? null);
                  setChatSheetJobMetadata({
                    title: detailJob?.title,
                    company: detailJob?.company,
                    location: detailJob?.location,
                    companyPublisher: detailJob?.companyPublisher ?? undefined,
                  });
                  setChatSheetOpen(true);
                }}
                className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border border-beige-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
              >
                <MessageCircle className="h-4 w-4 shrink-0" />
                Chat with AI
              </button>
              <button
                type="button"
                onClick={() => setDetailJob(null)}
                className="inline-flex min-h-[44px] min-w-[120px] items-center justify-center rounded-lg border border-beige-300 bg-white px-4 py-2.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

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

      {parseModalOpen && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-stone-900/50 p-4">
          <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-beige-300 bg-beige-50 shadow-xl">
            <div className="flex items-center justify-between border-b border-beige-300 px-4 py-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-800">
                <FileText className="h-5 w-5 text-orange-brand" />
                Paste Job Description
              </h2>
              <button
                type="button"
                onClick={() => {
                  setParseModalOpen(false);
                  setParsePaste("");
                  setParseResult(null);
                  setEditedParseJson("");
                  setEditedFields(null);
                  setShowJsonEditor(false);
                  setCopySuccess(false);
                }}
                className="rounded-lg p-1.5 text-stone-500 hover:bg-beige-200 hover:text-stone-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-thin">
              <textarea
                placeholder="Paste the full job description here..."
                value={parsePaste}
                onChange={(e) => setParsePaste(e.target.value)}
                rows={6}
                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 placeholder-stone-400 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleParse}
                  disabled={!parsePaste.trim() || parseLoading}
                  className="inline-flex items-center gap-2 rounded-lg bg-orange-brand px-4 py-2 text-sm font-medium text-white hover:bg-orange-dark disabled:opacity-50"
                >
                  {parseLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Parse with AI
                </button>
              </div>
              {parseResult && (
                <div className="rounded-lg border border-beige-300 bg-white p-4">
                  {"error" in parseResult ? (
                    <p className="text-sm text-red-600">{String(parseResult.error)}</p>
                  ) : (
                    <>
                      <div className="mb-4 flex items-center justify-between border-b border-beige-200 pb-3">
                        <p className="text-sm font-medium text-stone-700">
                          Parsed data — review, edit, and save
                        </p>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (!showJsonEditor && editedFields) {
                                const jsonData = {
                                  parsed: editedFields,
                                  record: editedFields,
                                };
                                setEditedParseJson(JSON.stringify(jsonData, null, 2));
                              }
                              setShowJsonEditor(!showJsonEditor);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-beige-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
                          >
                            {showJsonEditor ? "Form View" : "JSON View"}
                          </button>
                          <button
                            type="button"
                            onClick={handleCopyAll}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-beige-300 bg-white px-2.5 py-1.5 text-xs font-medium text-stone-700 hover:bg-beige-100 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
                            title="Copy all data to clipboard"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            {copySuccess ? "Copied!" : "Copy All"}
                          </button>
                        </div>
                      </div>

                      {showJsonEditor ? (
                        <div className="relative">
                          <textarea
                            value={editedParseJson}
                            readOnly
                            className="w-full max-h-96 min-h-[200px] overflow-auto rounded border border-beige-300 bg-beige-50 p-3 font-mono text-xs text-stone-700 scrollbar-thin cursor-default"
                            spellCheck={false}
                            placeholder="Parsed JSON will appear here..."
                          />
                          <div className="absolute top-2 right-2 rounded bg-beige-200/80 px-2 py-1 text-xs text-stone-600">
                            Read-only view
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
                          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Title *
                              </label>
                              <input
                                type="text"
                                value={editedFields?.title || ""}
                                onChange={(e) => updateField("title", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Company *
                              </label>
                              <input
                                type="text"
                                value={editedFields?.company || ""}
                                onChange={(e) => updateField("company", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Location *
                              </label>
                              <input
                                type="text"
                                value={editedFields?.location || ""}
                                onChange={(e) => updateField("location", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Role
                              </label>
                              <input
                                type="text"
                                value={editedFields?.role || ""}
                                onChange={(e) => updateField("role", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Experience
                              </label>
                              <input
                                type="text"
                                value={editedFields?.experience || ""}
                                onChange={(e) => updateField("experience", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Job Type
                              </label>
                              <input
                                type="text"
                                value={editedFields?.jobType || ""}
                                onChange={(e) => updateField("jobType", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Salary Min (INR/yearly)
                              </label>
                              <input
                                type="number"
                                value={editedFields?.salaryMin || ""}
                                onChange={(e) =>
                                  updateField(
                                    "salaryMin",
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Salary Max (INR/yearly)
                              </label>
                              <input
                                type="number"
                                value={editedFields?.salaryMax || ""}
                                onChange={(e) =>
                                  updateField(
                                    "salaryMax",
                                    e.target.value ? Number(e.target.value) : null
                                  )
                                }
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Seniority
                              </label>
                              <input
                                type="text"
                                value={editedFields?.seniority || ""}
                                onChange={(e) => updateField("seniority", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Availability
                              </label>
                              <input
                                type="text"
                                value={editedFields?.availability || ""}
                                onChange={(e) => updateField("availability", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Education
                              </label>
                              <input
                                type="text"
                                value={editedFields?.education || ""}
                                onChange={(e) => updateField("education", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-xs font-medium text-stone-600">
                                Posted At
                              </label>
                              <input
                                type="text"
                                value={editedFields?.postedAt || ""}
                                onChange={(e) => updateField("postedAt", e.target.value)}
                                className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-600">
                              Tech Stack (comma-separated)
                            </label>
                            <input
                              type="text"
                              value={editedFields?.techStack?.join(", ") || ""}
                              onChange={(e) =>
                                updateField(
                                  "techStack",
                                  e.target.value
                                    .split(",")
                                    .map((t) => t.trim())
                                    .filter(Boolean)
                                )
                              }
                              className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs font-medium text-stone-600">
                              Source
                            </label>
                            <input
                              type="text"
                              value={editedFields?.source || ""}
                              onChange={(e) => updateField("source", e.target.value)}
                              className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-1 focus:ring-orange-brand"
                            />
                          </div>
                        </div>
                      )}

                      <div className="mt-4 flex gap-2">
                        <button
                          type="button"
                          onClick={handleSaveParsed}
                          disabled={saveLoading || (!editedFields && !editedParseJson.trim())}
                          className="inline-flex items-center gap-2 rounded-lg bg-orange-brand px-3 py-2 text-sm font-medium text-white hover:bg-orange-dark disabled:opacity-50"
                        >
                          {saveLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Check className="h-4 w-4" />
                          )}
                          Save to tracker
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <input
        ref={importInputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={handleImportFileChange}
      />
      {exportModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/70 p-4">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-beige-300 bg-beige-50 shadow-2xl">
            <div className="flex items-start justify-between border-b border-beige-300 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-stone-800">Export Jobs</h2>
                <p className="mt-1 text-sm text-stone-500">
                  Download your tracker data in the format that matches your next step.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExportModalOpen(false)}
                className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-stone-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-4 p-6 md:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  handleExportJSON();
                  setExportModalOpen(false);
                }}
                className="rounded-2xl border border-beige-300 bg-white p-5 text-left shadow-sm transition hover:border-orange-brand hover:bg-beige-100"
              >
                <div className="mb-3 inline-flex rounded-xl bg-orange-brand/10 p-2 text-orange-brand">
                  <FileText className="h-5 w-5" />
                </div>
                <div className="text-base font-semibold text-stone-800">Export as JSON</div>
                <p className="mt-2 text-sm text-stone-600">
                  Best for backup, migration, and re-import. Includes the full job payload.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  handleExportCSV();
                  setExportModalOpen(false);
                }}
                className="rounded-2xl border border-beige-300 bg-white p-5 text-left shadow-sm transition hover:border-orange-brand hover:bg-beige-100"
              >
                <div className="mb-3 inline-flex rounded-xl bg-orange-brand/10 p-2 text-orange-brand">
                  <Briefcase className="h-5 w-5" />
                </div>
                <div className="text-base font-semibold text-stone-800">Export as CSV</div>
                <p className="mt-2 text-sm text-stone-600">
                  Best for spreadsheets and reporting. Includes key tracking columns in table form.
                </p>
              </button>
            </div>
          </div>
        </div>
      )}
      {importModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/70 p-4">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-beige-300 bg-beige-50 shadow-2xl">
            <div className="flex items-start justify-between border-b border-beige-300 px-6 py-5">
              <div>
                <h2 className="text-lg font-semibold text-stone-800">Import Jobs</h2>
                <p className="mt-1 text-sm text-stone-500">
                  {importProgress
                    ? importProgress.phase === "done"
                      ? "Import complete."
                      : "Import in progress…"
                    : "Import supports JSON only. Use the exported JSON format or the sample below."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!importLoading) {
                    setImportModalOpen(false);
                    setImportProgress(null);
                  }
                }}
                disabled={importLoading}
                className="rounded-lg p-2 text-stone-500 hover:bg-white hover:text-stone-700 disabled:opacity-40"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {importProgress ? (
              <div className="p-6 space-y-5">
                {/* Progress bar */}
                {importProgress.phase !== "done" && importProgress.valid > 0 && (
                  <div>
                    <div className="flex items-center justify-between text-xs text-stone-500 mb-1.5">
                      <span>
                        {importProgress.phase === "fetching_db"
                          ? "Fetching existing jobs from database…"
                          : importProgress.phase === "parsing"
                            ? "Parsing JSON file…"
                            : importProgress.phase === "checking"
                              ? "Checking for duplicates…"
                              : `Uploading ${importProgress.processed + 1} of ${importProgress.valid}`}
                      </span>
                      {importProgress.phase === "importing" && (
                        <span>
                          {Math.round((importProgress.processed / importProgress.valid) * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-beige-200 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-orange-brand transition-all duration-300 ease-out"
                        style={{
                          width:
                            importProgress.phase === "importing"
                              ? `${Math.max(2, (importProgress.processed / importProgress.valid) * 100)}%`
                              : "100%",
                        }}
                      />
                    </div>
                  </div>
                )}

                {importProgress.phase !== "done" && importProgress.valid === 0 && (
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    <Loader2 className="h-4 w-4 animate-spin text-orange-brand" />
                    {importProgress.phase === "fetching_db"
                      ? "Fetching existing jobs from database…"
                      : importProgress.phase === "parsing"
                        ? "Parsing JSON file…"
                        : "Checking for duplicates…"}
                  </div>
                )}

                {/* Current job being uploaded */}
                {importProgress.phase === "importing" && importProgress.currentTitle && (
                  <div className="flex items-start gap-3 rounded-xl border border-beige-300 bg-white p-3">
                    <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-orange-brand" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-stone-800 truncate">
                        {importProgress.currentTitle}
                      </div>
                      {importProgress.currentCompany && (
                        <div className="text-xs text-stone-500 truncate">
                          at {importProgress.currentCompany}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Live counters */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="rounded-xl border border-beige-300 bg-white p-3 text-center">
                    <div className="text-lg font-bold text-stone-800">{importProgress.total}</div>
                    <div className="text-xs text-stone-500">Total in file</div>
                  </div>
                  <div className="rounded-xl border border-green-200 bg-green-50 p-3 text-center">
                    <div className="text-lg font-bold text-green-700">{importProgress.created}</div>
                    <div className="text-xs text-green-600">Imported</div>
                  </div>
                  <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-center">
                    <div className="text-lg font-bold text-amber-700">
                      {importProgress.skippedDuplicate +
                        importProgress.skippedInvalid +
                        importProgress.skippedInFileDuplicate}
                    </div>
                    <div className="text-xs text-amber-600">Skipped</div>
                  </div>
                  <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-center">
                    <div className="text-lg font-bold text-red-700">{importProgress.failed}</div>
                    <div className="text-xs text-red-600">Failed</div>
                  </div>
                </div>

                {/* Detailed skip breakdown (visible during import + done) */}
                {(importProgress.skippedDuplicate > 0 ||
                  importProgress.skippedInvalid > 0 ||
                  importProgress.skippedInFileDuplicate > 0) && (
                  <div className="rounded-xl border border-beige-300 bg-white p-4 space-y-1.5 text-sm text-stone-600">
                    {importProgress.skippedDuplicate > 0 && (
                      <div className="flex justify-between">
                        <span>Already in database</span>
                        <span className="font-medium text-stone-800">
                          {importProgress.skippedDuplicate}
                        </span>
                      </div>
                    )}
                    {importProgress.skippedInFileDuplicate > 0 && (
                      <div className="flex justify-between">
                        <span>Duplicate within file</span>
                        <span className="font-medium text-stone-800">
                          {importProgress.skippedInFileDuplicate}
                        </span>
                      </div>
                    )}
                    {importProgress.skippedInvalid > 0 && (
                      <div className="flex justify-between">
                        <span>Missing title or company</span>
                        <span className="font-medium text-stone-800">
                          {importProgress.skippedInvalid}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Error message */}
                {importProgress.error && (
                  <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    {importProgress.error}
                  </div>
                )}

                {/* Done state: summary + close */}
                {importProgress.phase === "done" && (
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={() => {
                        setImportModalOpen(false);
                        setImportProgress(null);
                      }}
                      className="flex-1 rounded-lg bg-orange-brand py-3 text-sm font-medium text-white hover:bg-orange-dark"
                    >
                      {importProgress.created > 0
                        ? `Done — ${importProgress.created} job${importProgress.created === 1 ? "" : "s"} imported`
                        : "Close"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid gap-5 p-6 lg:grid-cols-[minmax(0,1.2fr)_320px]">
                <div className="min-w-0">
                  <div className="mb-3 text-sm font-medium text-stone-700">
                    Accepted JSON structure
                  </div>
                  <div className="overflow-x-auto rounded-2xl border border-beige-300 bg-stone-900 p-4">
                    <pre className="text-xs leading-6 text-stone-100">{`{
  "exportedAt": "2026-03-11T12:00:00.000Z",
  "count": 2,
  "jobs": [
    {
      "title": "Software Engineer",
      "company": "Example Inc",
      "location": "Remote",
      "role": "Frontend Engineer",
      "experience": "3+ years",
      "status": "applied",
      "appliedAt": "2026-03-11T12:00:00.000Z",
      "source": "LinkedIn"
    }
  ]
}`}</pre>
                  </div>
                </div>
                <div className="space-y-4">
                  <div className="rounded-2xl border border-beige-300 bg-white p-4">
                    <div className="text-sm font-semibold text-stone-800">Import rules</div>
                    <ul className="mt-3 space-y-2 text-sm text-stone-600">
                      <li>
                        <code>title</code> and <code>company</code> are required for each job.
                      </li>
                      <li>
                        Duplicate checks use <code>title + company</code> against the database.
                      </li>
                      <li>
                        JSON array and <code>{`{ "jobs": [...] }`}</code> formats are both accepted.
                      </li>
                    </ul>
                  </div>
                  <div className="rounded-2xl border border-dashed border-beige-300 bg-white p-4">
                    <div className="text-sm font-semibold text-stone-800">Ready to import?</div>
                    <p className="mt-2 text-sm text-stone-600">
                      Choose a `.json` file and the app will validate entries before importing.
                    </p>
                    <button
                      type="button"
                      onClick={handleClickImport}
                      disabled={importLoading}
                      className="mt-4 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-orange-brand px-4 py-2.5 text-sm font-medium text-white hover:bg-orange-dark disabled:opacity-60"
                    >
                      {importLoading ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Upload className="h-4 w-4" />
                      )}
                      Choose JSON File
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
