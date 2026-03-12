import type { Resume, Embedding, JobDescription } from "@/app/job/search/types";
import { db } from "@/app/job/search/lib/db";
import { sfn } from "@/lib/supabase-api";

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export async function generateResumeEmbeddings(resume: Resume): Promise<void> {
  if (!resume.isVerified) {
    throw new Error("Resume must be verified before generating embeddings");
  }

  const allEmbeddings = await db.embeddings.toArray();
  const existingEmbeddings = allEmbeddings.filter(
    (e) => e.entityId === resume.id && e.entityType === "resume"
  );

  if (existingEmbeddings.length > 0) {
    return;
  }

  const sections: Array<{ section: string; text: string }> = [];

  if (resume.parsedContent.skills.length > 0) {
    sections.push({
      section: "skills",
      text: resume.parsedContent.skills.join(", "),
    });
  }

  resume.parsedContent.experience.forEach((exp, index) => {
    const expText = `${exp.role} at ${exp.company}: ${exp.description}`;
    sections.push({
      section: `experience_${index}`,
      text: expText,
    });
  });

  resume.parsedContent.projects.forEach((proj, index) => {
    const projText = `${proj.name}: ${proj.description}`;
    sections.push({
      section: `project_${index}`,
      text: projText,
    });
  });

  resume.parsedContent.education.forEach((edu, index) => {
    const eduText = `${edu.degree}${edu.field ? ` in ${edu.field}` : ""} from ${edu.institution}`;
    sections.push({
      section: `education_${index}`,
      text: eduText,
    });
  });

  const { getApiKey } = await import("@/app/job/search/utils/api-key");
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key not set. Please set your API key in settings.");
  }

  for (const { section, text } of sections) {
    try {
      const response = await fetch(sfn("embeddings-generate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openai-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          entityId: resume.id,
          entityType: "resume",
          section,
        }),
      });

      if (!response.ok) {
        continue;
      }

      const result = await response.json();

      const embedding: Embedding = {
        id: result.id,
        entityId: resume.id,
        entityType: "resume",
        section,
        text,
        vector: result.embedding,
        createdAt: new Date(),
      };

      await db.embeddings.add(embedding);
    } catch (error) {}
  }
}

export async function generateJDEmbeddings(jd: JobDescription): Promise<void> {
  const allEmbeddings = await db.embeddings.toArray();
  const existingEmbeddings = allEmbeddings.filter(
    (e) => e.entityId === jd.id && e.entityType === "jd"
  );

  if (existingEmbeddings.length > 0) {
    return;
  }

  const sections: Array<{ section: string; text: string }> = [];

  if (jd.extracted.roleTitle && jd.extracted.roleTitle !== "Description:") {
    sections.push({
      section: "roleTitle",
      text: jd.extracted.roleTitle,
    });
  }

  if (jd.extracted.requiredSkills.length > 0) {
    sections.push({
      section: "requiredSkills",
      text: jd.extracted.requiredSkills.join(", "),
    });
  }

  if (jd.extracted.preferredSkills.length > 0) {
    sections.push({
      section: "preferredSkills",
      text: jd.extracted.preferredSkills.join(", "),
    });
  }

  jd.extracted.responsibilities.forEach((resp, index) => {
    sections.push({
      section: `responsibility_${index}`,
      text: resp,
    });
  });

  if (jd.extracted.company) {
    sections.push({
      section: "company",
      text: jd.extracted.company,
    });
  }

  const fullContent = jd.content;
  const chunkSize = 500;
  for (let i = 0; i < fullContent.length; i += chunkSize) {
    const chunk = fullContent.slice(i, i + chunkSize);
    if (chunk.trim().length > 0) {
      sections.push({
        section: `content_chunk_${Math.floor(i / chunkSize)}`,
        text: chunk,
      });
    }
  }

  const { getApiKey } = await import("@/app/job/search/utils/api-key");
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key not set. Please set your API key in settings.");
  }

  for (const { section, text } of sections) {
    try {
      const response = await fetch(sfn("embeddings-generate"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openai-api-key": apiKey,
        },
        body: JSON.stringify({
          text,
          entityId: jd.id,
          entityType: "jd",
          section,
        }),
      });

      if (!response.ok) {
        continue;
      }

      const result = await response.json();

      const embedding: Embedding = {
        id: result.id,
        entityId: jd.id,
        entityType: "jd",
        section,
        text,
        vector: result.embedding,
        createdAt: new Date(),
      };

      await db.embeddings.add(embedding);
    } catch (error) {}
  }
}

export async function searchEmbeddings(
  queryEmbedding: number[],
  entityId: string,
  entityType: "resume" | "jd",
  topK: number = 5
): Promise<Embedding[]> {
  const allEmbeddings = await db.embeddings.toArray();
  const entityEmbeddings = allEmbeddings.filter(
    (e) => e.entityId === entityId && e.entityType === entityType
  );

  if (entityEmbeddings.length === 0) {
    return [];
  }

  const similarities = entityEmbeddings.map((emb) => ({
    embedding: emb,
    similarity: cosineSimilarity(queryEmbedding, emb.vector),
  }));

  const topResults = similarities
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(({ embedding }) => embedding);

  return topResults;
}

export async function generateQueryEmbedding(query: string): Promise<number[]> {
  const { getApiKey } = await import("@/app/job/search/utils/api-key");
  const apiKey = getApiKey();

  if (!apiKey) {
    throw new Error("OpenAI API key not set. Please set your API key in settings.");
  }

  const response = await fetch(sfn("embeddings-generate"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-openai-api-key": apiKey,
    },
    body: JSON.stringify({
      text: query,
      entityId: "query",
      entityType: "resume",
      section: "query",
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to generate query embedding");
  }

  const result = await response.json();
  return result.embedding;
}
