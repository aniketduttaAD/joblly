import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { handleCors, jsonResponse, errorResponse } from "../_shared/cors.ts";

Deno.serve(async (req: Request) => {
  const cors = handleCors(req);
  if (cors) return cors;

  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  let body: { jdText?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse("Invalid JSON body", 400);
  }

  const jdText = body.jdText;
  if (!jdText || typeof jdText !== "string") {
    return errorResponse("Job description text is required", 400);
  }

  try {
    const extracted = extractJDInfo(jdText);
    return jsonResponse({ extracted });
  } catch (err) {
    console.error("POST /jd-extract error:", err);
    return errorResponse("Failed to extract JD information", 500);
  }
});

function extractJDInfo(text: string) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // Extract role title
  let roleTitle = "";
  const titlePatterns = [
    /(?:position|role|title|job title)[:\s]+(.+)/i,
    /^(.+?)\s*(?:position|role|job)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match) {
      roleTitle = match[1].trim();
      break;
    }
  }
  if (!roleTitle && lines.length > 0) roleTitle = lines[0];

  // Extract skills
  const requiredSkills: string[] = [];
  const preferredSkills: string[] = [];
  let inSkillsSection = false;
  let inRequiredSection = false;
  let inPreferredSection = false;

  for (const line of lines) {
    const ll = line.toLowerCase();
    if (ll.includes("required") && (ll.includes("skill") || ll.includes("qualification"))) {
      inSkillsSection = true;
      inRequiredSection = true;
      inPreferredSection = false;
      continue;
    }
    if (ll.includes("preferred") && (ll.includes("skill") || ll.includes("qualification"))) {
      inSkillsSection = true;
      inRequiredSection = false;
      inPreferredSection = true;
      continue;
    }
    if (ll.includes("skills") || ll.includes("qualifications")) {
      inSkillsSection = true;
      continue;
    }
    if (inSkillsSection) {
      const skills = line
        .split(/[,•\-\n]/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 50);
      if (inRequiredSection) requiredSkills.push(...skills);
      else if (inPreferredSection) preferredSkills.push(...skills);
      else requiredSkills.push(...skills);

      if (
        ll.includes("responsibilities") ||
        ll.includes("duties") ||
        ll.includes("experience") ||
        ll.includes("education")
      ) {
        inSkillsSection = false;
      }
    }
  }

  // Extract responsibilities
  const responsibilities: string[] = [];
  let inResponsibilitiesSection = false;

  for (const line of lines) {
    const ll = line.toLowerCase();
    if (
      ll.includes("responsibilities") ||
      ll.includes("duties") ||
      ll.includes("key responsibilities")
    ) {
      inResponsibilitiesSection = true;
      continue;
    }
    if (inResponsibilitiesSection) {
      if (line.length > 10) responsibilities.push(line);
      if (
        ll.includes("qualifications") ||
        ll.includes("requirements") ||
        ll.includes("experience") ||
        ll.includes("education") ||
        ll.includes("benefits")
      ) {
        inResponsibilitiesSection = false;
      }
    }
  }

  // Extract company
  let company: string | undefined;
  const companyPatterns = [
    /(?:at|company|organization)[:\s]+(.+)/i,
    /^(.+?)\s+(?:is|seeks|looking)/i,
  ];
  for (const pattern of companyPatterns) {
    const match = text.match(pattern);
    if (match) {
      company = match[1].trim();
      break;
    }
  }

  return {
    roleTitle: roleTitle || "Unknown Role",
    requiredSkills: [...new Set(requiredSkills)].slice(0, 20),
    preferredSkills: [...new Set(preferredSkills)].slice(0, 20),
    responsibilities: responsibilities.slice(0, 15),
    company,
  };
}
