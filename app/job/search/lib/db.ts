import Dexie, { Table } from "dexie";
import type { Resume, Chat, JobDescription, Message, Embedding } from "@/app/job/search/types";

export class JobifierDatabase extends Dexie {
  resumes!: Table<Resume, string>;
  chats!: Table<Chat, string>;
  jobDescriptions!: Table<JobDescription, string>;
  messages!: Table<Message, string>;
  embeddings!: Table<Embedding, string>;

  constructor() {
    super("JobifierDatabase");
    this.version(1).stores({
      resumes: "id, name, isVerified, createdAt, updatedAt",
      chats: "id, resumeId, jdId, title, createdAt, updatedAt",
      jobDescriptions: "id, chatId, createdAt",
      messages: "id, chatId, timestamp",
      embeddings: "id, entityId, entityType, section",
    });
  }
}

export const db = new JobifierDatabase();
