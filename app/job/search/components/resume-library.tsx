"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Eye, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import { hasApiKey } from "@/app/job/search/utils/api-key";
import { fetchWithAuth } from "@/lib/auth-client";
import { sfn } from "@/lib/supabase-api";
import { Button } from "@/app/job/search/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/job/search/components/ui/card";
import { Input } from "@/app/job/search/components/ui/input";
import { Textarea } from "@/app/job/search/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/job/search/components/ui/dialog";
import type { ParsedResume, Resume } from "@/app/job/search/types";
import { extractTextFromPdf } from "@/app/job/search/utils/pdf-text";
import { parseResumeTextEnhanced } from "@/app/job/search/utils/enhanced-resume-parser";

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function emptyStateMessage(compact: boolean): string {
  return compact
    ? "Upload a PDF resume here to use it across the app."
    : "No resumes yet. Upload your first PDF resume to get started.";
}

function toPrettyJson(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

type ResumeEditorState = {
  rawText: string;
  skills: string;
  experienceJson: string;
  projectsJson: string;
  educationJson: string;
};

function parsedResumeToEditorState(
  parsedContent: ParsedResume,
  content?: string
): ResumeEditorState {
  return {
    rawText: content ?? parsedContent.rawText ?? "",
    skills: parsedContent.skills.join(", "),
    experienceJson: toPrettyJson(parsedContent.experience),
    projectsJson: toPrettyJson(parsedContent.projects),
    educationJson: toPrettyJson(parsedContent.education),
  };
}

function editorStateToParsedResume(state: ResumeEditorState): ParsedResume {
  return {
    rawText: state.rawText.trim(),
    skills: state.skills
      .split(",")
      .map((skill) => skill.trim())
      .filter(Boolean),
    experience: JSON.parse(state.experienceJson || "[]") as ParsedResume["experience"],
    projects: JSON.parse(state.projectsJson || "[]") as ParsedResume["projects"],
    education: JSON.parse(state.educationJson || "[]") as ParsedResume["education"],
  };
}

function tryEditorStateToParsedResume(state: ResumeEditorState): ParsedResume | null {
  try {
    return editorStateToParsedResume(state);
  } catch {
    return null;
  }
}

function ParsedResumeEditor({
  state,
  onChange,
  readOnly = false,
}: {
  state: ResumeEditorState;
  onChange: (state: ResumeEditorState) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-2">
        <label className="text-sm font-medium text-stone-700">Skills</label>
        <Textarea
          value={state.skills}
          onChange={(event) => onChange({ ...state, skills: event.target.value })}
          className="min-h-[72px]"
          placeholder="React, Next.js, TypeScript, Node.js"
          readOnly={readOnly}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-stone-700">Raw Extracted Text</label>
        <Textarea
          value={state.rawText}
          onChange={(event) => onChange({ ...state, rawText: event.target.value })}
          className="min-h-[180px]"
          placeholder="Parsed resume text will appear here."
          readOnly={readOnly}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-stone-700">Experience JSON</label>
        <Textarea
          value={state.experienceJson}
          onChange={(event) => onChange({ ...state, experienceJson: event.target.value })}
          className="min-h-[180px] font-mono text-xs"
          readOnly={readOnly}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-stone-700">Projects JSON</label>
        <Textarea
          value={state.projectsJson}
          onChange={(event) => onChange({ ...state, projectsJson: event.target.value })}
          className="min-h-[140px] font-mono text-xs"
          readOnly={readOnly}
        />
      </div>
      <div className="grid gap-2">
        <label className="text-sm font-medium text-stone-700">Education JSON</label>
        <Textarea
          value={state.educationJson}
          onChange={(event) => onChange({ ...state, educationJson: event.target.value })}
          className="min-h-[140px] font-mono text-xs"
          readOnly={readOnly}
        />
      </div>
    </div>
  );
}

export function ResumeLibrary({
  compact = false,
  title = "Resume Manager",
  description = "Upload and manage PDF resumes stored in your tracker.",
}: {
  compact?: boolean;
  title?: string;
  description?: string;
}) {
  const { resumes, isLoading, loadResumes, addResume, deleteResume, verifyResume } =
    useResumeStore();

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [previewResumeId, setPreviewResumeId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadParsing, setUploadParsing] = useState(false);
  const [uploadParsed, setUploadParsed] = useState<ResumeEditorState | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [apiKeyExists, setApiKeyExists] = useState(false);
  const [previewEditorState, setPreviewEditorState] = useState<ResumeEditorState | null>(null);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewFileLoading, setPreviewFileLoading] = useState(false);

  const resetUploadState = () => {
    setUploadName("");
    setUploadFile(null);
    setUploadError("");
      setUploading(false);
      setUploadParsing(false);
      setUploadParsed(null);
  };

  useEffect(() => {
    loadResumes();
    setApiKeyExists(hasApiKey());

    const handleKeyUpdate = () => setApiKeyExists(hasApiKey());
    window.addEventListener("storage", handleKeyUpdate);
    window.addEventListener("apiKeyUpdated", handleKeyUpdate);
    return () => {
      window.removeEventListener("storage", handleKeyUpdate);
      window.removeEventListener("apiKeyUpdated", handleKeyUpdate);
    };
  }, [loadResumes]);

  const previewResume = useMemo(
    () => resumes.find((resume) => resume.id === previewResumeId) || null,
    [previewResumeId, resumes]
  );
  const uploadParsedPreview = useMemo(
    () => (uploadParsed ? tryEditorStateToParsedResume(uploadParsed) : null),
    [uploadParsed]
  );

  useEffect(() => {
    if (!previewResume) {
      setPreviewEditorState(null);
      return;
    }

    setPreviewEditorState(
      parsedResumeToEditorState(previewResume.parsedContent, previewResume.content)
    );
  }, [previewResume]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!previewResume) {
      setPreviewFileUrl(null);
      setPreviewFileLoading(false);
      return;
    }

    setPreviewFileLoading(true);
    setPreviewFileUrl(null);

    (async () => {
      try {
        const response = await fetchWithAuth(sfn("resume-file", { id: previewResume.id }), {
          method: "GET",
        });
        if (!response.ok) {
          throw new Error("Failed to load resume preview.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!active) return;
        setPreviewFileUrl(objectUrl);
      } catch {
        if (!active) return;
        setPreviewFileUrl(null);
      } finally {
        if (active) {
          setPreviewFileLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewResume]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setUploadError("");
    setUploadFile(file);
    setUploadParsed(null);
    if (file && !uploadName.trim()) {
      setUploadName(file.name.replace(/\.pdf$/i, ""));
    }

    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError("Only PDF files are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Resume file must be 5 MB or smaller.");
      return;
    }

    setUploadParsing(true);
    try {
      const extractedText = await extractTextFromPdf(file);

      const parsedContent = parseResumeTextEnhanced(extractedText);

      setUploadParsed(parsedResumeToEditorState(parsedContent, extractedText));
    } catch (error) {
      setUploadError(
        error instanceof Error ? error.message : "Failed to parse resume locally."
      );
    } finally {
      setUploadParsing(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("Choose a PDF file to continue.");
      return;
    }

    if (!uploadParsed) {
      setUploadError("Please wait for parsing to finish before uploading.");
      return;
    }

    setUploading(true);
    try {
      const parsedContent = editorStateToParsedResume(uploadParsed);
      await addResume({
        name: uploadName.trim() || uploadFile.name.replace(/\.pdf$/i, ""),
        file: uploadFile,
        content: uploadParsed.rawText.trim(),
        parsedContent,
      });
      setIsUploadDialogOpen(false);
      resetUploadState();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload resume.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (resumeId: string) => {
    setDeletingId(resumeId);
    try {
      await deleteResume(resumeId);
      if (previewResumeId === resumeId) {
        setPreviewResumeId(null);
      }
    } finally {
      setDeletingId(null);
    }
  };

  const handleVerify = async (resumeId: string) => {
    if (!apiKeyExists) {
      alert('Please set your OpenAI API key first. Use "Set API Key" in the bar at the top.');
      return;
    }
    setVerifyingId(resumeId);
    try {
      await verifyResume(resumeId);
    } catch (error) {
      alert(error instanceof Error ? error.message : "Failed to verify resume.");
    } finally {
      setVerifyingId(null);
    }
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className={compact ? "text-lg font-semibold" : "text-2xl font-bold"}>{title}</h2>
          <p className="text-sm text-stone-500">{description}</p>
        </div>
        <Button onClick={() => setIsUploadDialogOpen(true)} size={compact ? "sm" : "default"}>
          <Plus className="mr-2 h-4 w-4" />
          Add Resume
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-stone-500">Loading resumes...</div>
      ) : resumes.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-stone-500">
            {emptyStateMessage(compact)}
          </CardContent>
        </Card>
      ) : (
        <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
          {resumes.map((resume) => (
            <Card
              key={resume.id}
              className="overflow-hidden border-beige-300 bg-gradient-to-br from-white to-beige-100/60 transition-colors"
            >
              <CardHeader className={compact ? "pb-3" : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base">{resume.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {resume.sourceFileName || "PDF resume"} • {formatBytes(resume.fileSize)}
                    </CardDescription>
                  </div>
                  {resume.isVerified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs font-medium text-green-700">
                      <Check className="h-3.5 w-3.5" />
                      Verified
                    </span>
                  ) : (
                    <span className="rounded-full bg-yellow-50 px-2 py-1 text-xs font-medium text-yellow-700">
                      Pending
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-2 text-xs text-stone-600">
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.skills.length}
                    </div>
                    <div>Skills</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.experience.length}
                    </div>
                    <div>Experience</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.projects.length}
                    </div>
                    <div>Projects</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.education.length}
                    </div>
                    <div>Education</div>
                  </div>
                </div>

                <div className="rounded-xl border border-beige-300 bg-white/80 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Parsed Snapshot
                  </div>
                  <p className="line-clamp-3 text-sm text-stone-700">
                    {resume.parsedContent.skills.join(", ") || "No parsed skills yet."}
                  </p>
                </div>

                {!resume.isVerified && !apiKeyExists ? (
                  <div className="flex items-center gap-2 rounded-lg bg-yellow-50 p-2 text-xs text-yellow-700">
                    <AlertCircle className="h-4 w-4" />
                    API key required for verification
                  </div>
                ) : null}

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreviewResumeId(resume.id)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Parsed View
                  </Button>
                  {!resume.isVerified ? (
                    <Button
                      size="sm"
                      onClick={() => handleVerify(resume.id)}
                      disabled={!apiKeyExists || verifyingId === resume.id}
                    >
                      {verifyingId === resume.id ? "Verifying..." : "Verify"}
                    </Button>
                  ) : null}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(resume.id)}
                    disabled={deletingId === resume.id}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={isUploadDialogOpen}
        onOpenChange={(open) => {
          // Prevent closing the modal while parsing or uploading.
          if (!open && (uploading || uploadParsing)) {
            return;
          }
          setIsUploadDialogOpen(open);
          if (!open) {
            resetUploadState();
          }
        }}
      >
        <DialogContent className="h-[88vh] max-h-[88vh] max-w-6xl overflow-hidden border-beige-300 bg-beige-50 p-0">
          <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="border-b border-beige-300 bg-gradient-to-b from-white to-beige-100 p-6 lg:border-b-0 lg:border-r">
              <DialogHeader>
                <DialogTitle>Upload Resume</DialogTitle>
                <DialogDescription>
                  Select a PDF, parse it automatically, review the extracted data, then upload the
                  edited result.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-stone-700">Resume Name</label>
                  <Input
                    value={uploadName}
                    onChange={(event) => setUploadName(event.target.value)}
                    placeholder="e.g., Software Engineer"
                    disabled={uploading || uploadParsing}
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-stone-700">PDF File</label>
                  <Input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    disabled={uploading || uploadParsing}
                  />
                </div>
                {uploadFile ? (
                  <div className="rounded-2xl border border-beige-300 bg-white p-4 text-sm text-stone-600 shadow-sm">
                    <div className="flex items-start gap-3">
                      <div className="rounded-xl bg-orange-brand/10 p-2 text-orange-brand">
                        <FileText className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium text-stone-800">{uploadFile.name}</div>
                        <div>{formatBytes(uploadFile.size)}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
                <div className="rounded-2xl border border-dashed border-beige-300 bg-white/80 p-4 text-sm text-stone-600">
                  {uploadParsing ? (
                    <div className="flex items-center gap-2 text-orange-brand">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Parsing resume and building structured sections...
                    </div>
                  ) : uploadParsed ? (
                    <div className="space-y-2">
                      <div className="font-medium text-stone-800">Ready to upload</div>
                      {uploadParsedPreview ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>{uploadParsedPreview.skills.length} skills</div>
                          <div>{uploadParsedPreview.experience.length} roles</div>
                          <div>{uploadParsedPreview.projects.length} projects</div>
                          <div>{uploadParsedPreview.education.length} education</div>
                        </div>
                      ) : (
                        <div className="text-xs text-red-600">
                          Fix the JSON fields before uploading this resume.
                        </div>
                      )}
                    </div>
                  ) : (
                    <div>Select a PDF to parse and review it before upload.</div>
                  )}
                </div>
                {uploadError ? <p className="text-sm text-red-600">{uploadError}</p> : null}
                {uploadFile || uploadParsed || uploadName ? (
                  <Button
                    variant="ghost"
                    onClick={resetUploadState}
                    className="w-full"
                    disabled={uploading || uploadParsing}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-white">
              <div className="border-b border-beige-300 px-6 py-4 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-stone-800">Parsed Content Editor</div>
                  <div className="text-sm text-stone-500">
                    Adjust the parsed text and JSON before saving this resume.
                  </div>
                </div>
                {uploadParsed ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadParsing}
                    onClick={() => {
                      const next = parseResumeTextEnhanced(uploadParsed.rawText);
                      setUploadParsed(parsedResumeToEditorState(next, uploadParsed.rawText));
                    }}
                  >
                    Re-parse from raw text
                  </Button>
                ) : null}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                {uploadParsed ? (
                  <ParsedResumeEditor state={uploadParsed} onChange={setUploadParsed} />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-beige-300 bg-beige-50 text-sm text-stone-500">
                    Parsed resume content will appear here after file selection.
                  </div>
                )}
              </div>
              <DialogFooter className="border-t border-beige-300 px-6 py-4">
                <Button
                  variant="outline"
                  onClick={() => setIsUploadDialogOpen(false)}
                  disabled={uploading || uploadParsing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!uploadFile || !uploadParsed || uploading || uploadParsing}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Resume
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewResume != null}
        onOpenChange={(open) => {
          if (!open && (previewFileLoading || verifyingId || deletingId)) {
            return;
          }
          if (!open) {
            setPreviewResumeId(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-7xl overflow-hidden border-beige-300 bg-beige-50 p-0">
          <div className="grid h-full gap-0 xl:grid-cols-[minmax(0,1.15fr)_520px]">
            <div className="flex min-h-0 flex-col border-b border-beige-300 bg-white xl:border-b-0 xl:border-r">
              <div className="border-b border-beige-300 px-6 py-4">
                <DialogHeader className="pr-10">
                  <DialogTitle>{previewResume?.name || "Resume Preview"}</DialogTitle>
                  <DialogDescription>
                    Review the PDF and the stored parsed content for this resume.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-6">
                {previewFileLoading ? (
                  <div className="flex h-[65vh] items-center justify-center rounded-2xl border border-beige-300 bg-white text-sm text-stone-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading preview...
                  </div>
                ) : previewFileUrl ? (
                  <iframe
                    src={previewFileUrl}
                    title={`${previewResume?.name || "Resume"} preview`}
                    className="h-full min-h-[65vh] w-full rounded-2xl border border-beige-300 bg-white"
                  />
                ) : (
                  <div className="flex h-[65vh] items-center justify-center rounded-2xl border border-beige-300 bg-white text-sm text-stone-500">
                    Preview unavailable.
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-gradient-to-b from-beige-50 to-white">
              <div className="border-b border-beige-300 px-6 py-4">
                <div>
                  <div className="text-base font-semibold text-stone-800">
                    Stored Parsed Content
                  </div>
                  <div className="text-sm text-stone-500">
                    This is the parsed data saved with the resume record.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-b border-beige-300 px-6 py-4 text-sm text-stone-600">
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.skills.length ?? 0}
                  </div>
                  <div>skills</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.experience.length ?? 0}
                  </div>
                  <div>experience entries</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.projects.length ?? 0}
                  </div>
                  <div>projects</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.education.length ?? 0}
                  </div>
                  <div>education entries</div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                {previewEditorState ? (
                  <ParsedResumeEditor
                    state={previewEditorState}
                    onChange={setPreviewEditorState}
                    readOnly
                  />
                ) : null}
              </div>

              <div className="border-t border-beige-300 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    <FileText className="h-4 w-4" />
                    {previewResume?.sourceFileName || "PDF resume"} •{" "}
                    {formatBytes(previewResume?.fileSize)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
