import { del, get, put } from "@vercel/blob";

export function resumePdfPathname(userId: string, resumeId: string): string {
  return `resumes/${userId}/${resumeId}.pdf`;
}

export async function putPrivatePdf(pathname: string, body: ArrayBuffer, fileName: string) {
  return put(pathname, body, {
    access: "private",
    addRandomSuffix: false,
    allowOverwrite: false,
    contentType: "application/pdf",
    cacheControlMaxAge: 60 * 60,
  });
}

export async function getPrivateBlobStream(pathname: string) {
  return get(pathname, { access: "private" });
}

export async function deleteBlob(pathname: string) {
  return del(pathname);
}
