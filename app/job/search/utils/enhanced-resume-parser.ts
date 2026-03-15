/**
 * Enhanced resume parser — section-based, multi-line aware.
 *
 * Strategy:
 *  1. First pass: locate section boundaries by finding header lines.
 *  2. Second pass: parse each section in isolation with section-specific logic.
 *
 * This avoids the fragility of a single-pass approach where a section bleeds
 * into another and multi-line constructs (e.g. company name on one line, role
 * title on the next) are missed.
 */

export interface ParsedSection {
  skills: string[];
  experience: Array<{
    company: string;
    role: string;
    startDate: string;
    endDate?: string;
    description: string;
    achievements?: string[];
  }>;
  projects: Array<{
    name: string;
    description: string;
    technologies?: string[];
    duration?: string;
  }>;
  education: Array<{
    institution: string;
    degree: string;
    field?: string;
    graduationDate?: string;
    gpa?: string;
  }>;
  certifications?: Array<{
    name: string;
    issuer?: string;
    date?: string;
  }>;
  rawText: string;
}

// ── Shared patterns ──────────────────────────────────────────────────────────

/** Full-line date range: "Jan 2020 - Present" or "2018 - 2020" */
const DATE_RANGE_RE =
  /^(\w+\.?\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\.?\s+\d{4}|\d{4}|present|current)$/i;

/** Date range appearing anywhere in a line */
const PARTIAL_DATE_RANGE_RE =
  /(\w+\.?\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\.?\s+\d{4}|\d{4}|present|current)/i;

/** Standalone 4-digit year */
const YEAR_RE = /\b((?:19|20)\d{2})\b/;

/** CGPA / GPA pattern — "CGPA: 8.17/10" or "GPA 3.8" */
const GPA_RE =
  /(?:cgpa|gpa|grade(?:\s+point)?(?:\s+average)?)\s*:?\s*([\d.]+)\s*(?:\/\s*([\d.]+))?/i;

/**
 * Common degree abbreviations / keywords.
 * Deliberately broad so that "MCA", "BCA", "B.Tech" etc. all match.
 */
const DEGREE_RE =
  /\b(bachelor|master|phd|ph\.d\.?|doctorate|associate|diploma|certificate|b\.?\s*tech|m\.?\s*tech|b\.?\s*e\.?|m\.?\s*e\.?|b\.?\s*sc\.?|m\.?\s*sc\.?|mca|bca|mba|b\.?\s*com|m\.?\s*com)\b/i;

const INSTITUTION_RE =
  /\b(university|college|institute|school|academy|polytechnic)\b/i;

const BULLET_RE = /^[•\-\*]\s+/;

const ROLE_KEYWORDS_RE =
  /\b(engineer|developer|analyst|manager|designer|architect|consultant|specialist|lead|senior|junior|intern|director|officer|coordinator|associate|programmer|scientist|researcher|technician|administrator)\b/i;

const ACTION_VERBS_RE =
  /^(rebuilt|developed|created|implemented|designed|migrated|integrated|built|led|managed|improved|reduced|increased|launched|delivered|architected|optimized|automated|deployed|maintained|established|coordinated|spearheaded|streamlined|collaborated|contributed|engineered|oversaw|mentored|partnered)/i;

// ── Section detection ────────────────────────────────────────────────────────

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["summary", /^(professional\s+)?summary$|^objective$|^profile$/i],
  ["skills", /^(technical\s+|core\s+)?skills$/i],
  [
    "experience",
    /^(work\s+)?experience$|^employment(\s+history)?$|^work\s+history$|^professional\s+experience$|^career(\s+history)?$/i,
  ],
  ["projects", /^(key\s+)?projects?$|^portfolio$|^side\s+projects?$/i],
  [
    "education",
    /^education$|^academic(\s+(background|qualifications?|history))?$/i,
  ],
  [
    "certifications",
    /^certifications?$|^licenses?(\s*(&|and)\s*certifications?)?$|^courses?$/i,
  ],
];

function findSections(
  lines: string[]
): Map<string, { start: number; end: number }> {
  const found: { type: string; idx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Section headers are short; skip obviously long content lines
    if (line.length === 0 || line.length > 55) continue;

    for (const [type, pattern] of SECTION_PATTERNS) {
      if (pattern.test(line)) {
        // Skip duplicate consecutive detections of the same section type
        if (found.length === 0 || found[found.length - 1].type !== type) {
          found.push({ type, idx: i });
        }
        break;
      }
    }
  }

  const result = new Map<string, { start: number; end: number }>();
  for (let i = 0; i < found.length; i++) {
    const { type, idx } = found[i];
    const end = i + 1 < found.length ? found[i + 1].idx : lines.length;
    // First occurrence wins
    if (!result.has(type)) {
      result.set(type, { start: idx + 1, end });
    }
  }

  return result;
}

function getSectionLines(
  lines: string[],
  sections: Map<string, { start: number; end: number }>,
  type: string
): string[] {
  const s = sections.get(type);
  if (!s) return [];
  return lines.slice(s.start, s.end);
}

// ── Skills ───────────────────────────────────────────────────────────────────

function parseSkillsSection(lines: string[]): string[] {
  const skills: string[] = [];
  const stopWords =
    /^(and|or|the|a|an|languages?|frontend|backend|devops|core|tools?|frameworks?|others?)$/i;

  for (const line of lines) {
    // "Category: skill1, skill2" — only take the value part
    const content = line.includes(":")
      ? line.split(":").slice(1).join(":")
      : line;

    const parts = content
      .split(/[,•|\n;\/]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s.length < 60 && !stopWords.test(s));

    skills.push(...parts);
  }

  return [...new Set(skills)].filter((s) => s.length > 0);
}

// ── Experience ───────────────────────────────────────────────────────────────

type ExpEntry = ParsedSection["experience"][0] & { achievements: string[] };

function parseExperienceSection(
  lines: string[]
): ParsedSection["experience"] {
  const experience: ParsedSection["experience"] = [];
  let current: Partial<ExpEntry> | null = null;

  function flush() {
    if (current && (current.company || current.role)) {
      experience.push({
        company: current.company || "",
        role: current.role || "",
        startDate: current.startDate || "",
        endDate: current.endDate,
        description: (current.description || "").trim(),
        achievements: (current.achievements || []).filter((a) => a.length > 0),
      });
    }
    current = null;
  }

  function newEntry(overrides: Partial<ExpEntry> = {}) {
    flush();
    current = {
      company: "",
      role: "",
      startDate: "",
      description: "",
      achievements: [],
      ...overrides,
    };
  }

  /** Returns true when one of the next few lines is a date range. */
  function nearbyDateRange(from: number): boolean {
    const limit = Math.min(from + 4, lines.length);
    for (let j = from; j < limit; j++) {
      if (DATE_RANGE_RE.test(lines[j]) || PARTIAL_DATE_RANGE_RE.test(lines[j]))
        return true;
      // If we hit a bullet or a very long line, stop looking ahead
      if (BULLET_RE.test(lines[j]) || lines[j].length > 120) break;
    }
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ── Full date-range line ─────────────────────────────────────────────
    const fullDateMatch = line.match(DATE_RANGE_RE);
    if (fullDateMatch) {
      if (!current) newEntry();
      if (!current!.startDate) {
        current!.startDate = fullDateMatch[1]?.trim() || "";
        const endRaw = fullDateMatch[2]?.trim() || "";
        current!.endDate = /^(present|current)$/i.test(endRaw)
          ? undefined
          : endRaw;
      }
      continue;
    }

    // ── Bullet point → achievement ──────────────────────────────────────
    if (BULLET_RE.test(line)) {
      if (!current) newEntry();
      current!.achievements = current!.achievements || [];
      current!.achievements.push(line.replace(BULLET_RE, "").trim());
      continue;
    }

    // ── Action-verb sentence (description without bullet marker) ─────────
    if (ACTION_VERBS_RE.test(line) && line.length > 40) {
      if (current) {
        current.description =
          (current.description ? current.description + " " : "") + line;
      }
      continue;
    }

    // ── Inline "Role • Company" or "Role | Company" ──────────────────────
    if (line.length < 120) {
      const bulletSep = line.match(/^(.{2,70})\s*[•|]\s*(.{2,70})$/);
      const isDateAtDate =
        /^(\w+\s+\d{4}|\d{4})\s+at\s+(\w+\s+\d{4}|\d{4}|present|current)$/i.test(
          line
        );
      const atSep =
        !isDateAtDate &&
        line.match(/^(.{2,70}?)\s+\bat\b\s+(.{2,70})$/i);

      const sep = bulletSep || atSep;
      if (sep) {
        newEntry({ role: sep[1].trim(), company: sep[2].trim() });
        continue;
      }

      // "Role - Company" (not a date range, not an action verb)
      const dashSep =
        !DATE_RANGE_RE.test(line) &&
        !ACTION_VERBS_RE.test(line) &&
        line.match(/^(.{5,60}?)\s+[-–—]\s+(.{5,60})$/);
      if (dashSep) {
        newEntry({ role: dashSep[1].trim(), company: dashSep[2].trim() });
        continue;
      }
    }

    // ── Multi-line header detection ──────────────────────────────────────
    // Short line + a date range appears nearby → this is a job header.
    if (
      line.length > 2 &&
      line.length < 80 &&
      !ACTION_VERBS_RE.test(line) &&
      nearbyDateRange(i + 1)
    ) {
      if (ROLE_KEYWORDS_RE.test(line)) {
        // Looks like a role/title line
        if (!current) {
          newEntry({ role: line });
        } else if (!current.role) {
          current.role = line;
        } else if (!current.company) {
          current.company = line;
        } else {
          newEntry({ role: line });
        }
      } else {
        // Looks like a company name line
        if (!current) {
          newEntry({ company: line });
        } else if (!current.company) {
          current.company = line;
        } else if (!current.role) {
          current.role = line;
        } else {
          newEntry({ company: line });
        }
      }
      continue;
    }

    // ── Fallback: append to description ──────────────────────────────────
    if (line.length > 5 && current) {
      current.description =
        (current.description ? current.description + " " : "") + line;
    }
  }

  flush();
  return experience;
}

// ── Projects ─────────────────────────────────────────────────────────────────

function parseProjectsSection(lines: string[]): ParsedSection["projects"] {
  const projects: ParsedSection["projects"] = [];
  let cur: Partial<ParsedSection["projects"][0]> | null = null;

  function flushProject() {
    if (cur?.name) {
      if (!projects.some((p) => p.name === cur!.name)) {
        projects.push({
          name: cur.name,
          description: (cur.description || "").trim(),
          technologies: cur.technologies,
          duration: cur.duration,
        });
      }
    }
    cur = null;
  }

  for (const line of lines) {
    // Duration
    if (DATE_RANGE_RE.test(line) || PARTIAL_DATE_RANGE_RE.test(line)) {
      if (cur) cur.duration = line;
      continue;
    }

    // Tech stack
    if (
      /^(technologies?|tech(?:\s+stack)?|built\s+with|tools?|stack)\s*:/i.test(
        line
      )
    ) {
      if (cur) {
        cur.technologies =
          line
            .split(":")[1]
            ?.split(/[,;]/)
            .map((t) => t.trim())
            .filter(Boolean) || [];
      }
      continue;
    }

    // Bullet → description
    if (BULLET_RE.test(line)) {
      if (cur) {
        cur.description =
          (cur.description ? cur.description + " " : "") +
          line.replace(BULLET_RE, "").trim();
      }
      continue;
    }

    // Project name heuristic: short, starts with uppercase, not a degree/institution
    const looksLikeTitle =
      line.length > 3 &&
      line.length < 80 &&
      !DEGREE_RE.test(line) &&
      !INSTITUTION_RE.test(line) &&
      !ACTION_VERBS_RE.test(line) &&
      line[0] === line[0].toUpperCase() &&
      !line.startsWith("http");

    const looksLikeDescription =
      line.length > 70 ||
      /^(this|the|a |an |i |we |it )/i.test(line) ||
      ACTION_VERBS_RE.test(line);

    if (
      looksLikeTitle &&
      !looksLikeDescription &&
      (!cur || line !== cur.name)
    ) {
      flushProject();
      cur = { name: line, description: "" };
    } else if (cur && line.length > 5) {
      cur.description =
        (cur.description ? cur.description + " " : "") + line;
    }
  }

  flushProject();
  return projects;
}

// ── Education ────────────────────────────────────────────────────────────────

function parseEducationSection(
  lines: string[]
): ParsedSection["education"] {
  const education: ParsedSection["education"] = [];

  // Pending state accumulates across lines for a single entry
  let pendingDegree: string | null = null;
  let pendingInstitution: string | null = null;
  let pendingGpa: string | null = null;
  let pendingDate: string | null = null;

  function commitEntry() {
    if (pendingDegree || pendingInstitution) {
      const cleanStr = (s: string | null) =>
        (s || "")
          .replace(GPA_RE, "")
          .replace(/,?\s*(19|20)\d{2}.*$/, "")
          .trim();

      education.push({
        degree: cleanStr(pendingDegree),
        institution: cleanStr(pendingInstitution),
        graduationDate: pendingDate || undefined,
        gpa: pendingGpa || undefined,
      });
    }
    pendingDegree = null;
    pendingInstitution = null;
    pendingGpa = null;
    pendingDate = null;
  }

  for (const line of lines) {
    // Always extract GPA and year from every line in the section
    const gpaMatch = line.match(GPA_RE);
    if (gpaMatch && !pendingGpa) {
      pendingGpa = gpaMatch[2]
        ? `${gpaMatch[1]}/${gpaMatch[2]}`
        : gpaMatch[1];
    }

    const yearMatch = line.match(YEAR_RE);
    if (yearMatch && !pendingDate) {
      pendingDate = yearMatch[1];
    }

    const hasDegree = DEGREE_RE.test(line);
    const hasInstitution = INSTITUTION_RE.test(line);

    if (hasDegree && !hasInstitution) {
      // Pure degree line
      if (pendingDegree) {
        // Already have a degree pending — commit it before starting a new one
        commitEntry();
      }
      pendingDegree = line;
    } else if (hasInstitution && !hasDegree) {
      // Pure institution line
      if (pendingInstitution && !pendingDegree) {
        // Two institution lines in a row — commit previous
        commitEntry();
      }
      pendingInstitution = line;
      // If we already have a degree, this completes the pair
      if (pendingDegree) {
        commitEntry();
      }
    } else if (hasDegree && hasInstitution) {
      // Both on same line — commit pending state, then split this line
      commitEntry();

      const atIdx = line.search(/\b(at|from)\b/i);
      const commaIdx = line.indexOf(",");

      if (atIdx > 0) {
        pendingDegree = line.substring(0, atIdx).trim();
        pendingInstitution = line.substring(atIdx + 2).trim();
      } else if (commaIdx > 0) {
        pendingDegree = line.substring(0, commaIdx).trim();
        pendingInstitution = line.substring(commaIdx + 1).trim();
      } else {
        // Cannot split — set both and let cleanStr handle it
        pendingDegree = line;
        pendingInstitution = line;
      }
      commitEntry();
    }
    // Lines with neither keyword (location, CGPA-only line, year) contributed
    // to pendingGpa / pendingDate above and are otherwise ignored.
  }

  // Flush any trailing pending entry
  commitEntry();

  return education;
}

// ── Certifications ───────────────────────────────────────────────────────────

function parseCertificationsSection(
  lines: string[]
): NonNullable<ParsedSection["certifications"]> {
  const certs: NonNullable<ParsedSection["certifications"]> = [];

  for (const line of lines) {
    if (line.length < 3) continue;
    const clean = line.replace(BULLET_RE, "").trim();
    const dateMatch = clean.match(YEAR_RE);
    if (clean.length > 3) {
      certs.push({
        name: clean.replace(/,?\s*(19|20)\d{2}.*$/, "").trim(),
        date: dateMatch ? dateMatch[1] : undefined,
      });
    }
  }

  return certs;
}

// ── Main entry point ─────────────────────────────────────────────────────────

export function parseResumeTextEnhanced(text: string): ParsedSection {
  const lines = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const sections = findSections(lines);

  return {
    skills: parseSkillsSection(getSectionLines(lines, sections, "skills")),
    experience: parseExperienceSection(
      getSectionLines(lines, sections, "experience")
    ),
    projects: parseProjectsSection(
      getSectionLines(lines, sections, "projects")
    ),
    education: parseEducationSection(
      getSectionLines(lines, sections, "education")
    ),
    certifications: parseCertificationsSection(
      getSectionLines(lines, sections, "certifications")
    ),
    rawText: text,
  };
}
