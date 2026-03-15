"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Briefcase, Loader2, Send, X } from "lucide-react";
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
  kind: "chat" | "coverLetter" | "gaps";
};

type ChatSession = {
  chatId: string;
  queryCount: number;
  messages: SessionMessage[];
  jobMetadata: JobMetadata | null;
  resumeData: Resume;
  jobDescription: string;
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
  const [chatInput, setChatInput] = useState("");
  const [pendingUserMessage, setPendingUserMessage] = useState("");
  const [streamingContent, setStreamingContent] = useState("");
  const [sheetError, setSheetError] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isResponding, setIsResponding] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { resumes, loadResumes, isLoading: resumesLoading } = useResumeStore();

  const resetSession = useCallback(() => {
    setSelectedResumeId("");
    setJobDescriptionInput(initialJdText ?? "");
    setSession(null);
    setChatInput("");
    setPendingUserMessage("");
    setStreamingContent("");
    setSheetError("");
    setIsCreating(false);
    setIsResponding(false);
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
  const isBusy = isCreating || isResponding;

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
    } catch (error) {
      setSheetError(error instanceof Error ? error.message : "Failed to create chat session.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleSendMessage = async (prefilledQuestion?: string) => {
    if (!session || queryLimitReached) return;

    const question = (prefilledQuestion ?? chatInput).trim();
    if (!question) return;
    setSheetError("");
    setChatInput("");
    setPendingUserMessage(question);
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
      setPendingUserMessage("");
      setIsResponding(false);
      setStreamingContent("");
    }
  };

  const handleDedicatedAction = async (
    kind: Exclude<SessionMessage["kind"], "chat">,
    userContent: string,
    endpoint: "cover-letter" | "missing-resume-gaps"
  ) => {
    if (!session || queryLimitReached) return;

    setSheetError("");
    setChatInput("");
    setPendingUserMessage(userContent);
    setIsResponding(true);
    setStreamingContent("");

    try {
      const jdText = await ensureJobDescription();
      const response = await fetch(sfn(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          resumeData: buildAiResumePayload(session.resumeData),
          jdData: {
            content: jdText,
          },
          jobMetadata: session.jobMetadata ?? undefined,
        }),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(errorData.error || "Failed to generate a response.");
      }

      const fullContent = await readStreamedContent(response, setStreamingContent);
      appendQueryResult(
        kind,
        userContent,
        fullContent.trim() || "Sorry, I couldn't generate a response. Please try again."
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Sorry, I encountered an error. Please try again.";
      appendQueryResult(kind, userContent, errorMessage);
      setSheetError(errorMessage);
    } finally {
      setPendingUserMessage("");
      setIsResponding(false);
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
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3">
                {session.messages.length === 0 && !pendingUserMessage && !streamingContent ? (
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
                      {message.role === "user" ? "You" : "AI"}
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                  </div>
                ))}

                {pendingUserMessage ? (
                  <div className="ml-8 rounded-2xl bg-orange-brand p-3 text-sm text-white">
                    <div className="mb-1 text-[11px] uppercase tracking-[0.12em] opacity-70">
                      You
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{pendingUserMessage}</div>
                  </div>
                ) : null}

                {isResponding ? (
                  <div className="mr-8 rounded-2xl border border-beige-300 bg-white p-3 text-sm text-stone-700">
                    <div className="mb-1 text-[11px] uppercase tracking-[0.12em] text-stone-500">
                      AI
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">
                      {streamingContent || "Generating response..."}
                    </div>
                  </div>
                ) : null}

                <div ref={messagesEndRef} />
              </div>
            </div>

            <div className="shrink-0 border-t border-beige-300 bg-beige-50/95 p-4">
              {queryLimitReached ? (
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  Chat limit reached. Start a new chat to continue.
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex flex-wrap gap-2 pb-1">
                    <button
                      type="button"
                      onClick={() =>
                        void handleDedicatedAction(
                          "gaps",
                          "Outline exactly what is missing in my resume based on this JD.",
                          "missing-resume-gaps"
                        )
                      }
                      disabled={isBusy}
                      className="rounded-full border border-beige-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-beige-100 disabled:opacity-50"
                    >
                      What is missing in my resume?
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void handleDedicatedAction(
                          "coverLetter",
                          "Generate a cover letter for me for this role.",
                          "cover-letter"
                        )
                      }
                      disabled={isBusy}
                      className="rounded-full border border-beige-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-beige-100 disabled:opacity-50"
                    >
                      Generate cover letter
                    </button>
                  </div>
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
                      onClick={() => void handleSendMessage()}
                      disabled={!chatInput.trim() || isBusy}
                      size="sm"
                    >
                      {isResponding ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Generating...
                        </>
                      ) : (
                        <>
                          <Send className="mr-2 h-4 w-4" />
                          Send
                        </>
                      )}
                    </Button>
                  </div>
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
