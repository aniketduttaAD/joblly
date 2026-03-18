import type { AuthenticatedUserIdentity } from "./auth";
import { getSql } from "./neon";
import type { ParsedResume, Resume } from "@/app/job/search/types";

function rowToResume(row: Record<string, unknown>): Resume {
  return {
    id: row.id as string,
    name: (row.name as string) ?? "",
    content: (row.content as string) ?? "",
    parsedContent: row.parsed_content
      ? (JSON.parse(row.parsed_content as string) as ParsedResume)
      : ({ skills: [], experience: [], projects: [], education: [], rawText: "" } as ParsedResume),
    isVerified: (row.is_verified as boolean) ?? false,
    createdAt: new Date((row.created_at as string) ?? new Date().toISOString()),
    updatedAt: new Date((row.updated_at as string) ?? new Date().toISOString()),
    sourceFileName: (row.source_file_name as string | null) ?? undefined,
    fileSize: (row.file_size as number | null) ?? undefined,
    previewUrl: `/api/sfn/resume-file?id=${row.id as string}`,
  };
}

export async function listResumes(ownerId: string): Promise<Resume[]> {
  const sql = getSql();
  const rows = (await sql`
    select * from public.resumes
    where owner_id = ${ownerId}
    order by updated_at desc
  `) as Record<string, unknown>[];
  return rows.map(rowToResume);
}

export async function getResume(id: string, ownerId: string): Promise<Resume | null> {
  const sql = getSql();
  const rows = (await sql`
    select * from public.resumes
    where id = ${id} and owner_id = ${ownerId}
    limit 1
  `) as Record<string, unknown>[];
  const row = rows[0];
  return row ? rowToResume(row) : null;
}

export async function createResume(
  id: string,
  owner: AuthenticatedUserIdentity,
  file: { name: string; size: number; type: string },
  name: string,
  asset: { content: string; parsedContent: ParsedResume; blobPathname: string }
): Promise<Resume> {
  const sql = getSql();
  const now = new Date().toISOString();

  await sql`
    insert into public.resumes (
      id, owner_id, owner_email, owner_name,
      name, source_file_name, file_size, content_type,
      blob_pathname, content, parsed_content, is_verified,
      created_at, updated_at
    ) values (
      ${id}, ${owner.userId}, ${owner.email}, ${owner.name ?? null},
      ${name}, ${file.name}, ${file.size}, ${file.type || "application/pdf"},
      ${asset.blobPathname}, ${asset.content}, ${JSON.stringify(asset.parsedContent)}, true,
      ${now}, ${now}
    )
  `;

  return {
    id,
    name,
    content: asset.content,
    parsedContent: asset.parsedContent,
    isVerified: true,
    createdAt: new Date(now),
    updatedAt: new Date(now),
    sourceFileName: file.name,
    fileSize: file.size,
    previewUrl: `/api/sfn/resume-file?id=${id}`,
  };
}

export async function updateResumeMetadata(
  id: string,
  ownerId: string,
  updates: Partial<Pick<Resume, "content" | "parsedContent" | "isVerified">>
): Promise<Resume | null> {
  const current = await getResume(id, ownerId);
  if (!current) return null;

  const sql = getSql();
  const now = new Date().toISOString();

  const nextContent = updates.content ?? current.content;
  const nextParsed = updates.parsedContent ?? current.parsedContent;
  const nextVerified = updates.isVerified ?? current.isVerified;

  await sql`
    update public.resumes set
      content = ${nextContent},
      parsed_content = ${JSON.stringify(nextParsed)},
      is_verified = ${nextVerified},
      updated_at = ${now}
    where id = ${id} and owner_id = ${ownerId}
  `;

  return {
    ...current,
    content: nextContent,
    parsedContent: nextParsed,
    isVerified: nextVerified,
    updatedAt: new Date(now),
  };
}

export async function deleteResumeRow(
  id: string,
  ownerId: string
): Promise<{
  deleted: boolean;
  blobPathname: string | null;
}> {
  const sql = getSql();
  const rows = (await sql`
    select blob_pathname from public.resumes
    where id = ${id} and owner_id = ${ownerId}
    limit 1
  `) as Array<{ blob_pathname: string | null }>;
  const blobPathname = rows[0]?.blob_pathname ?? null;
  if (!rows[0]) return { deleted: false, blobPathname: null };

  await sql`delete from public.resumes where id = ${id} and owner_id = ${ownerId}`;
  return { deleted: true, blobPathname };
}

export async function getResumeFileInfo(
  id: string,
  ownerId: string
): Promise<{ blobPathname: string; fileName: string } | null> {
  const sql = getSql();
  const rows = (await sql`
    select source_file_name, blob_pathname from public.resumes
    where id = ${id} and owner_id = ${ownerId}
    limit 1
  `) as Array<{ source_file_name: string | null; blob_pathname: string | null }>;
  const row = rows[0];
  if (!row?.blob_pathname) return null;
  return {
    blobPathname: row.blob_pathname,
    fileName: row.source_file_name ?? `${id}.pdf`,
  };
}
