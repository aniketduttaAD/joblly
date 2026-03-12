import { create } from "zustand";
import type { JobDescription } from "@/app/job/search/types";
import { db } from "@/app/job/search/lib/db";

interface JDStore {
  jobDescriptions: JobDescription[];
  isLoading: boolean;
  error: string | null;

  loadJDs: () => Promise<void>;
  addJD: (jd: Omit<JobDescription, "id" | "createdAt">) => Promise<string>;
  getJD: (id: string) => Promise<JobDescription | undefined>;
  updateJD: (id: string, updates: Partial<JobDescription>) => Promise<void>;
  deleteJD: (id: string) => Promise<void>;
}

export const useJDStore = create<JDStore>((set, get) => ({
  jobDescriptions: [],
  isLoading: false,
  error: null,

  loadJDs: async () => {
    set({ isLoading: true, error: null });
    try {
      const jds = await db.jobDescriptions.toArray();
      set({ jobDescriptions: jds, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load job descriptions",
        isLoading: false,
      });
    }
  },

  addJD: async (jdData) => {
    const id = crypto.randomUUID();
    const jd: JobDescription = {
      ...jdData,
      id,
      createdAt: new Date(),
    };

    await db.jobDescriptions.add(jd);
    await get().loadJDs();
    return id;
  },

  getJD: async (id) => {
    return await db.jobDescriptions.get(id);
  },

  updateJD: async (id, updates) => {
    await db.jobDescriptions.update(id, updates);
    await get().loadJDs();
  },

  deleteJD: async (id) => {
    await db.jobDescriptions.delete(id);
    await get().loadJDs();
  },
}));
