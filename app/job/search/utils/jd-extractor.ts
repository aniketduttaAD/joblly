import { sfn } from "@/lib/supabase-api";

interface ExtractedJDData {
  roleTitle: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  company?: string;
}

export async function extractJDInfo(jdText: string): Promise<ExtractedJDData> {
  const response = await fetch(sfn("jd-extract"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jdText }),
  });

  if (!response.ok) {
    throw new Error("Failed to extract JD information");
  }

  const { extracted } = await response.json();
  return extracted;
}
