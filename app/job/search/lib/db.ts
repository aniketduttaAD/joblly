import Dexie, { Table } from "dexie";
import type { Resume } from "@/app/job/search/types";

export class JobifierDatabase extends Dexie {
  resumes!: Table<Resume, string>;

  constructor() {
    super("JobifierDatabase");
    this.version(2).stores({
      resumes: "id, name, isVerified, createdAt, updatedAt",
    });
  }
}

export const db = new JobifierDatabase();
