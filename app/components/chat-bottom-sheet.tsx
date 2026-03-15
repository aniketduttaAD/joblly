"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Download, Loader2, Send, X } from "lucide-react";
import { Button } from "@/app/job/search/components/ui/button";
import { Textarea } from "@/app/job/search/components/ui/textarea";
import { Input } from "@/app/job/search/components/ui/input";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import type { Resume } from "@/app/job/search/types";
import { sfn } from "@/lib/supabase-api";

const SHEET_WIDTH = 420;
const SHEET_HEIGHT = 640;
const MAX_QUERIES = 10;

type JobMetadata = {
  title?: string;
  company?: string;
  location?: string;
  companyPublisher?: string;
  aboutCompany?: string;
};

type SessionMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  kind: "chat" | "cover-letter" | "ats-resume";
};

type ChatSession = {
  chatId: string;
  queryCount: number;
  messages: SessionMessage[];
  jobMetadata: JobMetadata | null;
  resumeData: Resume;
  jobDescription: string;
};

type DownloadState = {
  coverLetter: string | null;
  atsResume: string | null;
};

interface ChatBottomSheetProps {
  open: boolean;
  onClose: () => void;
  initialJdText?: string;
  jobMetadata?: JobMetadata;
  loadFullJobDescription?: () => Promise<string | null>;
}

async function readStreamedContent(response: Response, onChunk: (content: string) => void) {
  if (!response.body) throw new Error("No response body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let fullContent = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6);
      if (data === "[DONE]") continue;
      try {
        const parsed = JSON.parse(data) as { content?: string };
        if (parsed.content) {
          fullContent += parsed.content;
          onChunk(fullContent);
        }
      } catch {
        continue;
      }
    }
  }

  return fullContent;
}

function downloadTextFile(
  content: string,
  fileName: string,
  mimeType = "text/plain;charset=utf-8"
) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function extractCandidateName(resumeName: string) {
  return resumeName
    .replace(/\.pdf$/i, "")
    .replace(/\s*resume$/i, "")
    .replace(
      /\s*-\s*(software engineer|frontend engineer|backend engineer|full stack developer|developer|engineer).*$/i,
      ""
    )
    .trim();
}

function buildAiResumePayload(resume: Resume) {
  return {
    ...resume,
    name: extractCandidateName(resume.name) || resume.name,
    content: "",
    parsedContent: resume.parsedContent,
  };
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function downloadPdfFromText(content: string, fileName: string) {
  const lines = content
    .replace(/\r/g, "")
    .split("\n")
    .flatMap((line) => {
      if (!line.trim()) return [""];
      const chunks: string[] = [];
      let remaining = line;
      while (remaining.length > 92) {
        chunks.push(remaining.slice(0, 92));
        remaining = remaining.slice(92);
      }
      chunks.push(remaining);
      return chunks;
    });

  const linesPerPage = 44;
  const pages: string[][] = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  const objects: string[] = [];
  const pageIds: number[] = [];

  objects.push("1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n");
  pageIds.push(0);
  objects.push("");
  objects.push("3 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n");

  let nextObjectId = 4;
  const contentIds: number[] = [];
  for (const pageLines of pages) {
    const pageId = nextObjectId++;
    const contentId = nextObjectId++;
    pageIds.push(pageId);
    contentIds.push(contentId);

    const contentStream = [
      "BT",
      "/F1 11 Tf",
      "50 792 Td",
      "14 TL",
      ...pageLines.map((line, index) =>
        `${index === 0 ? "" : "T* "}(${escapePdfText(line)}) Tj`.trim()
      ),
      "ET",
    ].join("\n");

    objects.push(
      `${pageId} 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >> endobj\n`
    );
    objects.push(
      `${contentId} 0 obj << /Length ${contentStream.length} >> stream\n${contentStream}\nendstream\nendobj\n`
    );
  }

  objects[1] = `2 0 obj << /Type /Pages /Count ${pages.length} /Kids [${pageIds
    .slice(1)
    .map((id) => `${id} 0 R`)
    .join(" ")}] >> endobj\n`;

  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ChatBottomSheet({
  open,
  onClose,
  initialJdText,
  jobMetadata,
  loadFullJobDescription,
}: ChatBottomSheetProps) {
  const [slideIn, setSlideIn] = useState(false);
  const [selectedResumeId, setSelectedResumeId] = useState<string>("");
  const [jobDescriptionInput, setJobDescriptionInput] = useState(initialJdText ?? "");
  const [session, setSession] = useState<ChatSession | null>(null);
  const [activeTab, setActiveTab] = useState<"chat" | "downloads">("chat");
  const [chatInput, setChatInput] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [downloads, setDownloads] = useState<DownloadState>({
    coverLetter: null,
    atsResume: null,
  });
  const [sheetError, setSheetError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isGeneratingAtsResume, setIsGeneratingAtsResume] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { resumes, loadResumes, isLoading: resumesLoading } = useResumeStore();

  const resetSession = useCallback(() => {
    setSelectedResumeId("");
    setJobDescriptionInput(initialJdText ?? "");
    setSession(null);
    setActiveTab("chat");
    setChatInput("");
    setStreamingContent("");
    setDownloads({ coverLetter: null, atsResume: null });
    setSheetError("");
    setIsCreating(false);
    setIsResponding(false);
    setIsGeneratingCoverLetter(false);
    setIsGeneratingAtsResume(false);
  }, [initialJdText]);

  useEffect(() => {
    if (!open) {
      setSlideIn(false);
      resetSession();
      return;
    }

    const t = requestAnimationFrame(() => {
      requestAnimationFrame(() => setSlideIn(true));
    });
    return () => cancelAnimationFrame(t);
  }, [open, resetSession]);

  useEffect(() => {
    if (!open) return;
    loadResumes(true);
  }, [open, loadResumes]);

  useEffect(() => {
    if (open) {
      setJobDescriptionInput(initialJdText ?? "");
    }
  }, [initialJdText, open]);

  useEffect(() => {
    if (resumes.length > 0 && !selectedResumeId) {
      setSelectedResumeId(resumes[0].id);
    }
  }, [resumes, selectedResumeId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session?.messages, streamingContent]);

  const selectedResume = useMemo(
    () => resumes.find((resume) => resume.id === selectedResumeId) || null,
    [resumes, selectedResumeId]
  );

  const canStartChat = Boolean(selectedResume && jobDescriptionInput.trim());
  const queryLimitReached = (session?.queryCount ?? 0) >= MAX_QUERIES;
  const isBusy = isCreating || isResponding || isGeneratingCoverLetter || isGeneratingAtsResume;

  const handleClose = () => {
    resetSession();
    onClose();
  };

  const ensureJobDescription = async () => {
    if (session?.jobDescription.trim()) return session.jobDescription;
    if (jobDescriptionInput.trim()) return jobDescriptionInput.trim();
    if (loadFullJobDescription) {
      const loaded = (await loadFullJobDescription())?.trim() || "";
      if (loaded) {
        setJobDescriptionInput(loaded);
        setSession((current) => (current ? { ...current, jobDescription: loaded } : current));
        return loaded;
      }
    }
    throw new Error(
      "Job description is missing. Please reopen the chat from a job with a valid JD."
    );
  };

  const appendQueryResult = (
    kind: SessionMessage["kind"],
    userContent: string,
    assistantContent: string
  ) => {
    setSession((current) => {
      if (!current) return current;
      return {
        ...current,
        queryCount: current.queryCount + 1,
        messages: [
          ...current.messages,
          { id: crypto.randomUUID(), role: "user", content: userContent, kind },
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: assistantContent,
            kind,
          },
        ],
      };
    });
  };

  const handleCreateChat = async () => {
    if (!selectedResume || !jobDescriptionInput.trim()) return;
    setSheetError("");
    setIsCreating(true);
    try {
      setSession({
        chatId: crypto.randomUUID(),
        queryCount: 0,
        messages: [],
        jobMetadata: jobMetadata ?? null,
        resumeData: selectedResume,
        jobDescription: jobDescriptionInput.trim(),
      });
      setActiveTab("chat");
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : "Failed to create chat session.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!session || !chatInput.trim() || queryLimitReached) return;

    const question = chatInput.trim();
    setSheetError("");
    setChatInput("");
    setIsResponding(true);
    setStreamingContent("");

    try {
      const jdText = await ensureJobDescription();
      const response = await fetch(sfn("chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeData: buildAiResumePayload(session.resumeData),
          jdData: {
            content: jdText,
            extracted: {
              roleTitle: session.jobMetadata?.title || "",
              company: session.jobMetadata?.company || undefined,
              requiredSkills: [],
              preferredSkills: [],
              responsibilities: [],
            },
          },
          question,
          chatHistory: session.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Failed to get a chat response.");
      }

      const fullContent = await readStreamedContent(response, setStreamingContent);
      appendQueryResult(
        "chat",
        question,
        fullContent.trim() || "Sorry, I couldn't generate a response. Please try again."
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Sorry, I encountered an error. Please try again.";
      appendQueryResult("chat", question, errorMessage);
      setSheetError(errorMessage);
    } finally {
      setIsResponding(false);
      setStreamingContent("");
    }
  };

  const handleGenerateCoverLetter = async () => {
    if (!session || queryLimitReached) return;
    setSheetError("");
    setIsGeneratingCoverLetter(true);
    setStreamingContent("");

    try {
      const jdText = await ensureJobDescription();
      const promptLabel = `Generate a cover letter for ${session.jobMetadata?.title || "this role"}.`;
      const response = await fetch(sfn("cover-letter"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeData: buildAiResumePayload(session.resumeData),
          jdData: {
            content: jdText,
            extracted: {
              roleTitle: session.jobMetadata?.title || "",
              company: session.jobMetadata?.company || undefined,
              requiredSkills: [],
              preferredSkills: [],
              responsibilities: [],
            },
          },
          jobMetadata: session.jobMetadata,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Failed to generate the cover letter.");
      }

      const fullContent = await readStreamedContent(response, setStreamingContent);
      const finalContent =
        fullContent.trim() || "Sorry, I couldn't generate the cover letter. Please try again.";

      setDownloads((current) => ({ ...current, coverLetter: finalContent }));
      appendQueryResult("cover-letter", promptLabel, finalContent);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to generate the cover letter.";
      appendQueryResult("cover-letter", "Generate cover letter", errorMessage);
      setSheetError(errorMessage);
    } finally {
      setIsGeneratingCoverLetter(false);
      setStreamingContent("");
    }
  };

  const handleGenerateAtsResume = async () => {
    if (!session || queryLimitReached) return;
    setSheetError("");
    setIsGeneratingAtsResume(true);
    setStreamingContent("");

    try {
      const jdText = await ensureJobDescription();
      const response = await fetch(sfn("ats-resume"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeData: buildAiResumePayload(session.resumeData),
          jdData: {
            content: jdText,
            extracted: {
              roleTitle: session.jobMetadata?.title || "",
              company: session.jobMetadata?.company || undefined,
              requiredSkills: [],
              preferredSkills: [],
              responsibilities: [],
            },
          },
          jobMetadata: session.jobMetadata,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Failed to generate the ATS resume.");
      }

      const fullContent = await readStreamedContent(response, setStreamingContent);
      const finalContent =
        fullContent.trim() ||
        "Unable to generate resume improvements. Please upload a valid resume.";

      setDownloads((current) => ({ ...current, atsResume: finalContent }));
      appendQueryResult("ats-resume", "Generate ATS verified resume", finalContent);
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to generate resume improvements. Please upload a valid resume.";
      appendQueryResult("ats-resume", "Generate ATS verified resume", errorMessage);
      setSheetError(errorMessage);
    } finally {
      setIsGeneratingAtsResume(false);
      setStreamingContent("");
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-stone-900/50 backdrop-blur-[2px]" aria-hidden />
      <div
        className="fixed z-50 flex flex-col rounded-t-2xl border border-beige-300 border-b-0 bg-beige-50 shadow-2xl transition-transform duration-300 ease-out"
        style={{
          right: 16,
          bottom: 0,
          width: SHEET_WIDTH,
          height: SHEET_HEIGHT,
          maxHeight: "90vh",
          maxWidth: "calc(100vw - 16px)",
          transform: slideIn ? "translateY(0)" : "translateY(100%)",
        }}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="chat-sheet-title"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-beige-300 bg-beige-50/95 px-4 py-3">
          <div>
            <h2 id="chat-sheet-title" className="text-lg font-semibold text-stone-800">
              Chat with AI
            </h2>
            {session ? (
              <p className="text-xs text-stone-500">
                {session.queryCount}/{MAX_QUERIES} queries used
              </p>
            ) : (
              <p className="text-xs text-stone-500">Session-only chat. Nothing is saved.</p>
            )}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="-mr-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-stone-500 hover:bg-beige-200 hover:text-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {!session ? (
          <div className="flex-1 overflow-y-auto p-4">
            {resumesLoading ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
                <p className="text-sm text-stone-500">Loading resumes...</p>
              </div>
            ) : resumes.length === 0 ? (
              <div className="rounded-2xl border border-beige-300 bg-white p-4 text-sm text-stone-600">
                Add a resume first to start an AI chat session.
              </div>
            ) : (
              <div className="space-y-4">
                <div className="rounded-2xl border border-beige-300 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Resume
                  </div>
                  <select
                    value={selectedResumeId}
                    onChange={(event) => setSelectedResumeId(event.target.value)}
                    className="mt-2 h-11 w-full rounded-lg border border-beige-300 bg-white px-3 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
                  >
                    {resumes.map((resume) => (
                      <option key={resume.id} value={resume.id}>
                        {resume.name}
                      </option>
                    ))}
                  </select>
                  {selectedResume ? (
                    <p className="mt-2 text-xs text-stone-500">
                      {selectedResume.parsedContent.skills.length} skills,{" "}
                      {selectedResume.parsedContent.experience.length} experience entries
                    </p>
                  ) : null}
                </div>

                {jobMetadata?.title || jobMetadata?.company || jobMetadata?.location ? (
                  <div className="rounded-2xl border border-beige-300 bg-white p-4">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-orange-brand/10 p-2 text-orange-brand">
                        <Briefcase className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-medium text-stone-800">
                          {jobMetadata?.title || "Selected role"}
                        </div>
                        <div className="text-sm text-stone-500">
                          {[jobMetadata?.company, jobMetadata?.location]
                            .filter(Boolean)
                            .join(" · ")}
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}

                <div className="rounded-2xl border border-beige-300 bg-white p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Job Description
                  </div>
                  <Textarea
                    value={jobDescriptionInput}
                    onChange={(event) => setJobDescriptionInput(event.target.value)}
                    placeholder="Paste the full job description here."
                    className="mt-2 min-h-[220px]"
                  />
                  <p className="mt-2 text-xs text-stone-500">
                    The full JD is only used when the chat session is created or when generation is
                    requested.
                  </p>
                </div>

                {sheetError ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                    {sheetError}
                  </div>
                ) : null}

                <Button
                  onClick={handleCreateChat}
                  disabled={!canStartChat || isCreating}
                  className="w-full"
                  size="lg"
                >
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creating...
                    </>
                  ) : (
                    "Create Chat"
                  )}
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid shrink-0 grid-cols-2 gap-2 border-b border-beige-300 px-4 py-3">
              <button
                type="button"
                onClick={() => setActiveTab("chat")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  activeTab === "chat"
                    ? "bg-orange-brand text-white"
                    : "border border-beige-300 bg-white text-stone-700"
                }`}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("downloads")}
                className={`rounded-lg px-3 py-2 text-sm font-medium ${
                  activeTab === "downloads"
                    ? "bg-orange-brand text-white"
                    : "border border-beige-300 bg-white text-stone-700"
                }`}
              >
                Downloads
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === "chat" ? (
                <div className="space-y-3">
                  {session.messages.length === 0 && !streamingContent ? (
                    <div className="rounded-2xl border border-dashed border-beige-300 bg-white p-4 text-sm text-stone-500">
                      Ask about resume fit, likely interview questions, missing skills, or how the
                      role matches your background.
                    </div>
                  ) : null}

                  {session.messages.map((message) => (
                    <div
                      key={message.id}
                      className={`rounded-2xl p-3 text-sm ${
                        message.role === "user"
                          ? "ml-8 bg-orange-brand text-white"
                          : "mr-8 border border-beige-300 bg-white text-stone-700"
                      }`}
                    >
                      <div className="mb-1 text-[11px] uppercase tracking-[0.12em] opacity-70">
                        {message.role === "user" ? "You" : message.kind.replace("-", " ")}
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                    </div>
                  ))}

                  {streamingContent ? (
                    <div className="mr-8 rounded-2xl border border-beige-300 bg-white p-3 text-sm text-stone-700">
                      <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-stone-500">
                        AI
                      </div>
                      <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
                    </div>
                  ) : null}

                  <div ref={messagesEndRef} />
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-beige-300 bg-white p-4">
                    <div className="text-sm font-medium text-stone-800">Downloads</div>
                    <div className="mt-1 text-xs text-stone-500">
                      Cover letter and ATS resume generations each count as one query.
                    </div>
                  </div>

                  <div className="grid gap-3">
                    <div className="rounded-2xl border border-beige-300 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-stone-800">Generate Cover Letter</div>
                          <div className="text-xs text-stone-500">
                            Uses your parsed resume and the full JD.
                          </div>
                        </div>
                        <Button
                          onClick={handleGenerateCoverLetter}
                          disabled={queryLimitReached || isBusy}
                          size="sm"
                        >
                          {isGeneratingCoverLetter ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Generate"
                          )}
                        </Button>
                      </div>
                      {downloads.coverLetter ? (
                        <div className="mt-3 space-y-3">
                          <div className="max-h-40 overflow-y-auto rounded-xl border border-beige-300 bg-beige-50 p-3 text-sm text-stone-700 whitespace-pre-wrap">
                            {downloads.coverLetter}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              downloadTextFile(downloads.coverLetter || "", "cover-letter.txt")
                            }
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                          </Button>
                        </div>
                      ) : null}
                    </div>

                    <div className="rounded-2xl border border-beige-300 bg-white p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="font-medium text-stone-800">
                            Generate ATS Verified Resume
                          </div>
                          <div className="text-xs text-stone-500">
                            Keeps the same resume structure and improves keyword coverage.
                          </div>
                        </div>
                        <Button
                          onClick={handleGenerateAtsResume}
                          disabled={queryLimitReached || isBusy}
                          size="sm"
                        >
                          {isGeneratingAtsResume ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            "Generate"
                          )}
                        </Button>
                      </div>
                      {downloads.atsResume ? (
                        <div className="mt-3 space-y-3">
                          <div className="max-h-40 overflow-y-auto rounded-xl border border-beige-300 bg-beige-50 p-3 text-sm text-stone-700 whitespace-pre-wrap">
                            {downloads.atsResume}
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              downloadPdfFromText(
                                downloads.atsResume || "",
                                "ats-optimized-resume.pdf"
                              )
                            }
                          >
                            <Download className="mr-2 h-4 w-4" />
                            Download
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="shrink-0 border-t border-beige-300 bg-beige-50/95 p-4">
              {queryLimitReached ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Chat limit reached. Start a new chat to continue.
                </div>
              ) : activeTab === "chat" ? (
                <div className="space-y-2">
                  <Input
                    value={chatInput}
                    onChange={(event) => setChatInput(event.target.value)}
                    placeholder="Ask about this role, your resume fit, or interview prep..."
                    disabled={isBusy}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        void handleSendMessage();
                      }
                    }}
                  />
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs text-stone-500">
                      Query {session.queryCount + 1} of {MAX_QUERIES}
                    </div>
                    <Button
                      onClick={handleSendMessage}
                      disabled={!chatInput.trim() || isBusy}
                      size="sm"
                    >
                      {isResponding ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <>
                          <Send className="mr-2 h-4 w-4" />
                          Send
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-xs text-stone-500">
                  Download actions also use the shared 10-query session limit.
                </div>
              )}
              {sheetError ? <p className="mt-2 text-sm text-red-600">{sheetError}</p> : null}
            </div>
          </>
        )}
      </div>
    </>
  );
}
