import { create } from "zustand";
import type { ParsedResume, Resume } from "@/app/job/search/types";
import { db } from "@/app/job/search/lib/db";
import { fetchWithAuth } from "@/lib/auth-client";
import { sfn } from "@/lib/supabase-api";

interface ResumeStore {
  resumes: Resume[];
  selectedResumeId: string | null;
  isLoading: boolean;
  error: string | null;
  lastLoadedAt: number | null;
  loadResumes: (force?: boolean) => Promise<void>;
  addResume: (payload: {
    name: string;
    file: File;
    content?: string;
    parsedContent?: ParsedResume;
  }) => Promise<string>;
  deleteResume: (id: string) => Promise<void>;
  selectResume: (id: string | null) => void;
  verifyResume: (id: string) => Promise<void>;
  reparseResume: (id: string) => Promise<void>;
  updateResume: (
    id: string,
    updates: Partial<Pick<Resume, "content" | "parsedContent">>
  ) => Promise<void>;
  getSelectedResume: () => Resume | null;
}

async function parseError(response: Response, fallback: string): Promise<Error> {
  const data = (await response.json().catch(() => ({}))) as { error?: string };
  return new Error(data.error || fallback);
}

async function deleteResumeArtifacts(id: string): Promise<void> {
  const allChats = await db.chats.toArray();
  const linkedChats = allChats.filter((chat) => chat.resumeId === id);

  for (const chat of linkedChats) {
    await db.messages.where("chatId").equals(chat.id).delete();
    await db.chats.delete(chat.id);
  }

  const allEmbeddings = await db.embeddings.toArray();
  const resumeEmbeddings = allEmbeddings.filter(
    (embedding) => embedding.entityId === id && embedding.entityType === "resume"
  );
  for (const embedding of resumeEmbeddings) {
    await db.embeddings.delete(embedding.id);
  }
}

export const useResumeStore = create<ResumeStore>((set, get) => ({
  resumes: [],
  selectedResumeId: null,
  isLoading: false,
  error: null,
  lastLoadedAt: null,

  loadResumes: async (force = false) => {
    const { lastLoadedAt, resumes, isLoading } = get();
    if (
      !force &&
      !isLoading &&
      lastLoadedAt &&
      resumes.length > 0 &&
      Date.now() - lastLoadedAt < 5 * 60 * 1000
    ) {
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(sfn("resumes"), { method: "GET" });
      if (!response.ok) {
        throw await parseError(response, "Failed to load resumes");
      }
      const data = (await response.json()) as { resumes?: Resume[] };
      const resumes = Array.isArray(data.resumes)
        ? data.resumes.map((resume) => ({
            ...resume,
            createdAt: new Date(resume.createdAt),
            updatedAt: new Date(resume.updatedAt),
          }))
        : [];

      const selectedResumeId = get().selectedResumeId;
      set({
        resumes,
        lastLoadedAt: Date.now(),
        selectedResumeId:
          selectedResumeId && resumes.some((resume) => resume.id === selectedResumeId)
            ? selectedResumeId
            : null,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load resumes",
        isLoading: false,
      });
    }
  },

  addResume: async ({ name, file, content, parsedContent }) => {
    const formData = new FormData();
    formData.append("name", name);
    formData.append("file", file);
    if (typeof content === "string") {
      formData.append("content", content);
    }
    if (parsedContent) {
      formData.append("parsedContent", JSON.stringify(parsedContent));
    }

    const response = await fetchWithAuth(sfn("resumes"), {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      throw await parseError(response, "Failed to upload resume");
    }

    const resume = (await response.json()) as Resume;
    const normalizedResume = {
      ...resume,
      createdAt: new Date(resume.createdAt),
      updatedAt: new Date(resume.updatedAt),
    };

    set((state) => ({
      resumes: [normalizedResume, ...state.resumes],
      lastLoadedAt: Date.now(),
      selectedResumeId: normalizedResume.id,
    }));

    return normalizedResume.id;
  },

  deleteResume: async (id) => {
    const response = await fetchWithAuth(sfn("resume-by-id", { id }), {
      method: "DELETE",
    });
    if (!response.ok) {
      throw await parseError(response, "Failed to delete resume");
    }

    await deleteResumeArtifacts(id);
    set((state) => ({
      resumes: state.resumes.filter((resume) => resume.id !== id),
      lastLoadedAt: Date.now(),
      selectedResumeId: state.selectedResumeId === id ? null : state.selectedResumeId,
    }));
  },

  selectResume: (id) => {
    set({ selectedResumeId: id });
  },

  verifyResume: async (id) => {
    const { getApiKey } = await import("@/app/job/search/utils/api-key");
    const apiKey = getApiKey();

    if (!apiKey) {
      throw new Error(
        "OpenAI API key is required to verify resumes. Please set your API key in settings first."
      );
    }

    const current = get().resumes.find((resume) => resume.id === id);
    if (!current) {
      throw new Error("Resume not found");
    }

    const response = await fetchWithAuth(sfn("resume-by-id", { id }), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ isVerified: true }),
    });
    if (!response.ok) {
      throw await parseError(response, "Failed to verify resume");
    }

    set((state) => ({
      resumes: state.resumes.map((resume) =>
        resume.id === id ? { ...resume, isVerified: true, updatedAt: new Date() } : resume
      ),
      lastLoadedAt: Date.now(),
    }));

    try {
      const { generateResumeEmbeddings } = await import("@/app/job/search/utils/embeddings");
      await generateResumeEmbeddings({ ...current, isVerified: true });
    } catch (error) {
      await fetchWithAuth(`/api/resumes/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ isVerified: false }),
      }).catch(() => {});
      set((state) => ({
        resumes: state.resumes.map((resume) =>
          resume.id === id ? { ...resume, isVerified: false, updatedAt: new Date() } : resume
        ),
        lastLoadedAt: Date.now(),
      }));
      throw error;
    }
  },

  reparseResume: async (id) => {
    const current = get().resumes.find((resume) => resume.id === id);
    if (!current) {
      throw new Error("Resume not found");
    }

    const { parseResumeTextEnhanced } =
      await import("@/app/job/search/utils/enhanced-resume-parser");
    const parsedContent = parseResumeTextEnhanced(current.content);

    const allEmbeddings = await db.embeddings.toArray();
    const oldEmbeddings = allEmbeddings.filter(
      (embedding) => embedding.entityId === id && embedding.entityType === "resume"
    );
    for (const embedding of oldEmbeddings) {
      await db.embeddings.delete(embedding.id);
    }

    const response = await fetchWithAuth(sfn("resume-by-id", { id }), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: current.content,
        parsedContent,
        isVerified: false,
      }),
    });
    if (!response.ok) {
      throw await parseError(response, "Failed to re-parse resume");
    }

    set((state) => ({
      resumes: state.resumes.map((resume) =>
        resume.id === id
          ? {
              ...resume,
              parsedContent,
              isVerified: false,
              updatedAt: new Date(),
            }
          : resume
      ),
      lastLoadedAt: Date.now(),
    }));
  },

  updateResume: async (id, updates) => {
    const response = await fetchWithAuth(sfn("resume-by-id", { id }), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(updates),
    });
    if (!response.ok) {
      throw await parseError(response, "Failed to update resume");
    }

    const resume = (await response.json()) as Resume;
    set((state) => ({
      resumes: state.resumes.map((entry) =>
        entry.id === id
          ? {
              ...resume,
              createdAt: new Date(resume.createdAt),
              updatedAt: new Date(resume.updatedAt),
            }
          : entry
      ),
      lastLoadedAt: Date.now(),
    }));
  },

  getSelectedResume: () => {
    const { selectedResumeId, resumes } = get();
    return selectedResumeId
      ? resumes.find((resume) => resume.id === selectedResumeId) || null
      : null;
  },
}));
