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

const DATE_RANGE_RE = /^(\w+\.?\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\.?\s+\d{4}|\d{4}|present|current)$/i;
const PARTIAL_DATE_RANGE_RE =
  /(\w+\.?\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\.?\s+\d{4}|\d{4}|present|current)/i;
const MONTH_RE =
  /(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)/i;
const COMPANY_ROLE_DATE_RE = new RegExp(
  `^(.{2,80}?)\\s+(${MONTH_RE.source}\\s+\\d{4}\\s*[-–—]\\s*(?:Present|Current|\\w+\\s+\\d{4}|\\d{4}))(?:\\s|\\(|$)`
);
const EDUCATION_DATE_IN_PARENS = /\s*[·•]\s*\(([^)]+)\)\s*$/;
const INSTITUTION_THEN_DEGREE_RE =
  /^(.+?)\s+(Bachelor|Master|Foundation|INTERMEDIATE|Diploma|B\.?\s*Com|M\.?\s*Com|Associate|Certificate|High\s+School\s+Diploma)\b\s*(.*)$/i;
const YEAR_RE = /\b((?:19|20)\d{2})\b/;
const GPA_RE =
  /(?:cgpa|gpa|grade(?:\s+point)?(?:\s+average)?)\s*:?\s*([\d.]+)\s*(?:\/\s*([\d.]+))?/i;
const DEGREE_RE =
  /\b(bachelor|master|phd|ph\.d\.?|doctorate|associate|diploma|certificate|foundation|intermediate|b\.?\s*tech|m\.?\s*tech|b\.?\s*e\.?|m\.?\s*e\.?|b\.?\s*sc\.?|m\.?\s*sc\.?|mca|bca|mba|b\.?\s*com|m\.?\s*com|high\s*school|chartered\s*accountancy|higher\s*secondary\s*education)\b/i;

const INSTITUTION_RE = /\b(university|college|institute|school|academy|polytechnic)\b/i;

const BULLET_RE = /^[•\-\*]\s+/;
const BULLET_INLINE_RE = /\s+[•·]\s+/;

const ROLE_KEYWORDS_RE =
  /\b(engineer|developer|analyst|manager|designer|architect|consultant|specialist|lead|senior|junior|intern|director|officer|coordinator|associate|programmer|scientist|researcher|technician|administrator|executive|accountant|full\s*stack|software|mobile|frontend|backend)\b/i;

const ACTION_VERBS_RE =
  /^(rebuilt|developed|created|implemented|designed|migrated|integrated|built|led|managed|improved|reduced|increased|launched|delivered|architected|optimized|automated|deployed|maintained|established|coordinated|spearheaded|streamlined|collaborated|contributed|engineered|oversaw|mentored|partnered)/i;
const ACTION_VERBS_ANYWHERE_RE =
  /\b(rebuilt|developed|created|implemented|designed|migrated|integrated|built|led|managed|improved|reduced|increased|launched|delivered|architected|optimized|automated|deployed|maintained|established|coordinated|spearheaded|streamlined|collaborated|contributed|engineered|oversaw|mentored|partnered|simulated|applied|conducted|calculated|presented|proposed|participated|demonstrated|worked)\b/i;

const SECTION_PATTERNS: Array<[string, RegExp]> = [
  ["summary", /^(professional\s+)?summary$|^objective$|^profile$/i],
  ["skills", /^(top\s+)?(technical\s+|core\s+)?(skills|competencies)$/i],
  [
    "experience",
    /^(work\s+)?experience$|^employment(\s+history)?$|^work\s+history$|^professional\s+experience$|^career(\s+history)?$/i,
  ],
  ["additional_experience", /^additional\s+experience$/i],
  ["projects", /^(key\s+)?projects?$|^portfolio$|^side\s+projects?$/i],
  ["education", /^education$|^academic(\s+(background|qualifications?|history))?$/i],
  ["certifications", /^certifications?$|^licenses?(\s*(&|and)\s*certifications?)?$|^courses?$/i],
];

const INLINE_SECTION_BREAKS: Array<[RegExp, string]> = [
  [/\s+(PROFESSIONAL\s+SUMMARY)\b/g, "\n$1\n"],
  [
    /\s+(TECHNICAL\s+SKILLS|CORE\s+COMPETENCIES|WORK\s+EXPERIENCE|PROFESSIONAL\s+EXPERIENCE|EMPLOYMENT\s+HISTORY|PROJECTS|EDUCATION|CERTIFICATIONS|ADDITIONAL\s+EXPERIENCE)\b/g,
    "\n$1\n",
  ],
  [/\s+(Summary)(?=\s+[A-Z])/g, "\nSummary\n"],
  [/\s+(Objective)(?=\s+[A-Z])/g, "\nObjective\n"],
  [/\s+(Profile)(?=\s+[A-Z])/g, "\nProfile\n"],
  [
    /\s+(Top\s+Skills|Technical\s+Skills|Core\s+Skills|Core\s+Competencies)(?=\s+(?:Languages?:|Frontend|Backend|DevOps|Core|QA|Tax|Accounting|Technical|[A-Z]))/gi,
    "\n$1\n",
  ],
  [
    /\s+(Work\s+Experience|Professional\s+Experience|Employment\s+History|Career\s+History)(?=\s+[A-Z])/gi,
    "\n$1\n",
  ],
  [/\s+(Key\s+Projects|Portfolio|Side\s+Projects)(?=\s+[A-Z])/gi, "\n$1\n"],
  [
    /\s+(Education|Academic\s+Background)(?=\s+(?:Bachelor|Master|Diploma|Associate|Certificate|B\\.?\\s*Tech|M\\.?\\s*Tech|BCA|MCA|MBA|B\\.?\\s*Com|M\\.?\\s*Com|High\\s+School))/gi,
    "\n$1\n",
  ],
  [/\s+(Certifications|Courses)(?=\s+[A-Z])/gi, "\n$1\n"],
  [/\s+(Additional\s+Experience)(?=\s+[A-Z])/gi, "\n$1\n"],
];

const EDUCATION_SECTION_BOUNDARY_RE =
  /^(core\s+competencies|additional\s+experience|(key\s+)?projects?|(work\s+)?experience|tax\s*&\s*compliance|accounting\s*&\s*finance|technical\s+skills)\s*:?\s*$/i;

function normalizeResumeText(text: string): string {
  let normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ");

  for (const [pattern, replacement] of INLINE_SECTION_BREAKS) {
    normalized = normalized.replace(pattern, replacement);
  }

  return normalized
    .replace(
      /((?:\w+\.?\s+\d{4}|\d{4})\s*[-–—]\s*(?:\w+\.?\s+\d{4}|\d{4}|Present|Current))(?=\s+[A-Z])/g,
      "$1\n"
    )
    .replace(/(?<=\.\s)(?=[A-Z][A-Za-z][A-Za-z/&.+ -]{1,60}\s+[•|]\s+[A-Z])/g, "\n")
    .replace(
      /(?<=\d\/\d{1,2})\s+(?=(?:Bachelor|Master|Diploma|Associate|Certificate|B\.?\s*Tech|M\.?\s*Tech|BCA|MCA|MBA|B\.?\s*Com|M\.?\s*Com|High\s+School))/gi,
      "\n"
    )
    .replace(
      /\s+(?=(?:Chartered\s+Accountancy|Bachelor|Master|Higher\s+Secondary\s+Education)\b)/g,
      "\n"
    )
    .replace(
      /\s+(?=(?:The\s+Institute\s+of|[A-Z][A-Za-z&.,()'-]+\s+(?:University|College|Institute|School|Academy))\b)/g,
      "\n"
    )
    .replace(
      /(?<=\.\s)(?=(?:Simulated|Applied|Built|Conducted|Calculated|Presented|Proposed|Participated|Collaborated|Demonstrated|Worked)\b)/g,
      "\n"
    )
    .replace(
      /\s+(?=[A-Z][A-Za-z& ]{2,60}\s+[-–—]\s+[A-Z][A-Za-z0-9&. ]{2,80}\s+(?:Simulated|Applied|Built|Conducted|Calculated|Presented|Proposed|Participated|Collaborated|Demonstrated|Worked)\b)/g,
      "\n"
    )
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .trim();
}

function findSections(lines: string[]): Map<string, { start: number; end: number }> {
  const found: { type: string; idx: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || line.length > 70) continue;

    for (const [type, pattern] of SECTION_PATTERNS) {
      if (pattern.test(line)) {
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

const NOT_SKILL_RE = /^(seeking\s|page\s*\d*|\d+)$|(?:Bengaluru|Karnataka|India|,\s*India)$/i;
const LOOKS_LIKE_NAME_RE = /^[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?$/;
const PROJECT_LINK_RE =
  /^(demo|github|gitlab|live|link|case\s+study|play\s+store|app\s+store|website)\b/i;
const PROJECT_LABEL_RE =
  /^(languages?|frontend(?:\s*&\s*mobile)?|backend(?:\s*&\s*database)?|devops(?:\s*&\s*tools)?|core\s+concepts|qa\s*&\s*testing|frameworks?|technologies?|tech\s+stack|tools?|stack|tax\s*&\s*compliance|accounting\s*&\s*finance|technical\s+skills)\s*:/i;
const LOCATION_RE =
  /\b(india|bengaluru|bangalore|karnataka|delhi|mumbai|pune|hyderabad|chennai|remote|onsite|new york|san francisco|london)\b/i;
const KNOWN_MULTIWORD_SKILL_RE =
  /^(React Native|Spring Boot|Cloud Messaging|Data Structures|System Design|Distributed Systems|Functional Testing|Tailwind CSS|RESTful APIs|API Testing|Machine Learning|Deep Learning|Computer Vision|Natural Language Processing|Income Tax Returns Filing|GST Returns Preparation|Indirect Tax Compliance|VAT Knowledge|Tax Computation|Tax Returns Preparation|Financial Statement Analysis|Account Reconciliation|Month-End Closing|Cash Flow Statement|Trial Balance|Journal Entries|Budget Analysis|Process Improvement|Financial Reporting|Data Analysis|Financial Analysis|Working Independently|Problem Resolution)$/i;

function cleanLine(line: string): string {
  return line
    .replace(/\u00a0/g, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/[|]/g, " • ")
    .trim();
}

function stripDateRange(text: string): string {
  return text
    .replace(PARTIAL_DATE_RANGE_RE, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function parseDateRange(text: string): { startDate: string; endDate?: string } | null {
  const match = text.match(PARTIAL_DATE_RANGE_RE);
  if (!match) return null;
  const startDate = match[1]?.trim() || "";
  const endRaw = match[2]?.trim() || "";
  return {
    startDate,
    endDate: /^(present|current)$/i.test(endRaw) ? undefined : endRaw,
  };
}

function looksLikeSectionHeader(line: string): boolean {
  return SECTION_PATTERNS.some(([, pattern]) => pattern.test(line.trim()));
}

function splitInlineBullets(line: string): string[] {
  return line
    .split(BULLET_INLINE_RE)
    .map((part) => part.trim())
    .filter(Boolean);
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function splitTitleAndDescription(line: string): { title: string; description: string } | null {
  const match = line.match(ACTION_VERBS_ANYWHERE_RE);
  if (!match || match.index == null) return null;
  const title = line
    .slice(0, match.index)
    .trim()
    .replace(/\s+[–—-]\s*$/, "");
  const description = line.slice(match.index).trim();
  if (title.length < 3 || description.length < 10) return null;
  return { title, description };
}

function coalesceProjectLines(lines: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let current = cleanLine(lines[i]);
    if (!current) continue;

    if (/^[A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+){0,2}$/.test(current)) {
      let j = i + 1;
      while (j < lines.length) {
        const next = cleanLine(lines[j]);
        if (!next) {
          j++;
          continue;
        }
        if (
          /^[A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+){0,3}$/.test(next) ||
          /^([A-Z][A-Za-z&.]+(?:\s+[A-Z][A-Za-z&.]+){0,4})\s+[-–—]\s+.+$/.test(next)
        ) {
          current = `${current} ${next}`.trim();
          i = j;
          if (/[-–—]/.test(next)) break;
          j++;
          continue;
        }
        break;
      }
    }

    result.push(current);
  }
  return result;
}

function normalizeSkillToken(token: string): string {
  return token
    .replace(/^[^A-Za-z0-9+#.]+/, "")
    .replace(/[^A-Za-z0-9+#.\-/ ]+$/g, "")
    .replace(/\bCI\/CD\b/i, "CI/CD")
    .trim();
}

function isLikelyNotSkill(token: string): boolean {
  if (token.length > 50) return true;
  if (KNOWN_MULTIWORD_SKILL_RE.test(token.trim())) return false;
  if (NOT_SKILL_RE.test(token.trim())) return true;
  if (
    LOOKS_LIKE_NAME_RE.test(token) &&
    !/^(Power\s+BI|Tally\s+ERP|Cost\s+Accounting|Income\s+Tax|GST|CA\s+Inter)$/i.test(token)
  )
    return true;
  if (
    /^[A-Z][a-z]+\s+[A-Z][a-z]+$/.test(token) &&
    !/\b(Excel|Power BI|Tally ERP|Volunteer Management|Cost Accounting|Income Tax)\b/i.test(token)
  )
    return true;
  return false;
}

function parseSkillsSection(lines: string[]): string[] {
  const skills: string[] = [];
  const stopWords =
    /^(and|or|the|a|an|languages?|frontend|backend|devops|core|tools?|frameworks?|others?)$/i;

  for (const line of lines) {
    const normalizedLine = cleanLine(line);
    const parts: string[] = [];
    const segments = normalizedLine.split(
      /(?=\s*(?:Languages?|Frontend(?:\s*&\s*Mobile)?|Backend(?:\s*&\s*Database)?|DevOps(?:\s*&\s*Tools)?|Core\s+Concepts|QA\s*&\s*Testing|Frameworks?|Technologies?|Tech\s+Stack|Top\s+Skills)\s*:)/i
    );
    for (const seg of segments) {
      const content = PROJECT_LABEL_RE.test(seg) ? seg.replace(/^[^:]+:\s*/, "").trim() : seg;
      const tokens = content
        .split(/[,•\n;]+/)
        .map((s) => normalizeSkillToken(s))
        .filter(
          (s) =>
            s.length > 0 &&
            s.length < 85 &&
            !stopWords.test(s) &&
            !PROJECT_LABEL_RE.test(s) &&
            !isLikelyNotSkill(s)
        );
      parts.push(...tokens);
    }
    if (parts.length === 0) {
      const content = normalizedLine.includes(":")
        ? normalizedLine.split(":").slice(1).join(":").trim()
        : normalizedLine;
      const tokens = content
        .split(/[,•\n;]+/)
        .map((s) => normalizeSkillToken(s))
        .filter(
          (s) =>
            s.length > 0 &&
            s.length < 85 &&
            !stopWords.test(s) &&
            !PROJECT_LABEL_RE.test(s) &&
            !isLikelyNotSkill(s)
        );
      parts.push(...tokens);
    }
    skills.push(...parts);
    const explicitMatches = [
      ...normalizedLine.matchAll(
        /\b(Microsoft Excel|Excel|Power BI|Tally ERP(?: 9\/Prime)?|MS Word|PowerPoint|Financial Reporting|Income Tax|Indirect Tax|Cost Accounting|GST compliance|Financial Statement Preparation|Account Reconciliation|Financial Analysis)\b/gi
      ),
    ].map((match) => match[0]);
    skills.push(...explicitMatches);
  }

  return dedupeStrings(skills).filter((s) => s.length > 0 && !isLikelyNotSkill(s));
}

type ExpEntry = ParsedSection["experience"][0] & { achievements: string[] };

function parseExperienceSection(lines: string[]): ParsedSection["experience"] {
  const experience: ParsedSection["experience"] = [];
  type CurrentEntry = Partial<ExpEntry> & {
    description?: string;
    achievements?: string[];
    startDate?: string;
    endDate?: string;
  };
  let current: CurrentEntry | null = null;

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

  function nearbyDateRange(from: number): boolean {
    const limit = Math.min(from + 4, lines.length);
    for (let j = from; j < limit; j++) {
      if (DATE_RANGE_RE.test(lines[j]) || PARTIAL_DATE_RANGE_RE.test(lines[j])) return true;
      if (BULLET_RE.test(lines[j]) || lines[j].length > 120) break;
    }
    return false;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = cleanLine(lines[i]);
    if (!line || looksLikeSectionHeader(line)) continue;

    const fullDateMatch = line.match(DATE_RANGE_RE);
    if (fullDateMatch) {
      if (!current) newEntry();
      if (!current!.startDate) {
        current!.startDate = fullDateMatch[1]?.trim() || "";
        const endRaw = fullDateMatch[2]?.trim() || "";
        current!.endDate = /^(present|current)$/i.test(endRaw) ? undefined : endRaw;
      }
      continue;
    }

    const partialDateMatch = line.match(PARTIAL_DATE_RANGE_RE);
    if (partialDateMatch && !fullDateMatch) {
      if (!current) newEntry();
      const cur = current as CurrentEntry | null;
      if (cur && !cur.startDate) {
        cur.startDate = partialDateMatch[1]?.trim() || "";
        const endRaw = partialDateMatch[2]?.trim() || "";
        cur.endDate = /^(present|current)$/i.test(endRaw) ? undefined : endRaw;
      }
      if (line.trim().length < 40) continue;
    }

    const inlineParts = splitInlineBullets(stripDateRange(line));
    if (inlineParts.length >= 2 && inlineParts.length <= 4 && parseDateRange(line)) {
      const roleCandidate = inlineParts.find((part) => ROLE_KEYWORDS_RE.test(part));
      const companyCandidate = inlineParts.find(
        (part) =>
          part !== roleCandidate &&
          !ROLE_KEYWORDS_RE.test(part) &&
          !LOCATION_RE.test(part) &&
          !/^[+]?[\d\s()-]{7,}$/.test(part)
      );
      if (roleCandidate || companyCandidate) {
        newEntry({
          role: roleCandidate || "",
          company: companyCandidate || "",
          ...parseDateRange(line),
        });
        continue;
      }
    }

    const roleCompanyBullet = line.match(
      /^(.{3,75}?)\s*[•|]\s*(.{2,75}?)(?=\s{2,}|$|\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4})/
    );
    if (roleCompanyBullet) {
      const rolePart = roleCompanyBullet[1].trim();
      const companyPart = roleCompanyBullet[2].trim();
      if (
        rolePart &&
        companyPart &&
        !DATE_RANGE_RE.test(rolePart) &&
        !DATE_RANGE_RE.test(companyPart)
      ) {
        newEntry({ role: rolePart, company: companyPart });
        const cur = current as CurrentEntry | null;
        if (partialDateMatch && cur) {
          cur.startDate = partialDateMatch[1]?.trim() || "";
          const endRaw = partialDateMatch[2]?.trim() || "";
          cur.endDate = /^(present|current)$/i.test(endRaw) ? undefined : endRaw;
        }
        continue;
      }
    }

    const companyRoleThenDate = line.match(COMPANY_ROLE_DATE_RE);
    if (companyRoleThenDate) {
      const beforeDate = companyRoleThenDate[1].trim();
      const datePart = companyRoleThenDate[2];
      const dateMatch = datePart.match(PARTIAL_DATE_RANGE_RE);
      const roleKeywordMatch = beforeDate.match(
        /\s+(\S+(?:\s+\S+)*?\s+(?:analyst|manager|engineer|developer|designer|consultant|specialist|director|officer|coordinator|executive|accountant))$/i
      );
      if (roleKeywordMatch) {
        const role = roleKeywordMatch[1].trim();
        const company = beforeDate.slice(0, roleKeywordMatch.index).trim();
        if (company.length >= 2 && company.length <= 50) {
          newEntry({ company, role });
          const cur = current as CurrentEntry | null;
          if (dateMatch && cur) {
            cur.startDate = dateMatch[1]?.trim() || "";
            const endRaw = dateMatch[2]?.trim() || "";
            cur.endDate = /^(present|current)$/i.test(endRaw) ? undefined : endRaw;
          }
          continue;
        }
      }
      const oneWordCompany = beforeDate.match(/^(\w+)\s+(.+)$/);
      if (oneWordCompany && ROLE_KEYWORDS_RE.test(oneWordCompany[2])) {
        newEntry({ company: oneWordCompany[1].trim(), role: oneWordCompany[2].trim() });
        const cur = current as CurrentEntry | null;
        if (dateMatch && cur) {
          cur.startDate = dateMatch[1]?.trim() || "";
          const endRaw = dateMatch[2]?.trim() || "";
          cur.endDate = /^(present|current)$/i.test(endRaw) ? undefined : endRaw;
        }
        continue;
      }
    }

    if (BULLET_RE.test(line)) {
      if (!current) newEntry();
      current!.achievements = current!.achievements || [];
      current!.achievements.push(line.replace(BULLET_RE, "").trim());
      continue;
    }

    if (ACTION_VERBS_RE.test(line) && line.length > 40) {
      if (current) {
        (current as any).description =
          ((current as any).description ? (current as any).description + " " : "") + line;
      }
      continue;
    }

    const titleAndDescription = splitTitleAndDescription(line);
    if (
      titleAndDescription &&
      /^(.{2,100}?)\s+[-–—]\s+(.{2,160})$/.test(titleAndDescription.title)
    ) {
      const sep = titleAndDescription.title.match(/^(.{2,100}?)\s+[-–—]\s+(.{2,160})$/);
      if (sep) {
        newEntry({
          role: sep[1].trim(),
          company: sep[2].trim(),
          description: titleAndDescription.description,
        });
        continue;
      }
    }

    if (line.length < 120 && !partialDateMatch) {
      const bulletSep = line.match(/^(.{2,70})\s*[•|]\s*(.{2,70})$/);
      const isDateAtDate = /^(\w+\s+\d{4}|\d{4})\s+at\s+(\w+\s+\d{4}|\d{4}|present|current)$/i.test(
        line
      );
      const atSep = !isDateAtDate && line.match(/^(.{2,70}?)\s+\bat\b\s+(.{2,70})$/i);

      const sep = bulletSep || atSep;
      if (sep) {
        newEntry({ role: sep[1].trim(), company: sep[2].trim() });
        continue;
      }

      const dashSep =
        !DATE_RANGE_RE.test(line) &&
        !ACTION_VERBS_RE.test(line) &&
        line.match(/^(.{5,60}?)\s+[-–—]\s+(.{5,60})$/);
      if (dashSep) {
        newEntry({ role: dashSep[1].trim(), company: dashSep[2].trim() });
        continue;
      }
    }

    if (
      line.length > 2 &&
      line.length < 80 &&
      !ACTION_VERBS_RE.test(line) &&
      nearbyDateRange(i + 1)
    ) {
      if (ROLE_KEYWORDS_RE.test(line)) {
        if (!current) {
          newEntry({ role: line });
        } else if (!(current as any).role) {
          (current as any).role = line;
        } else if (!(current as any).company) {
          (current as any).company = line;
        } else {
          newEntry({ role: line });
        }
      } else {
        if (!current) {
          newEntry({ company: line });
        } else if (!(current as any).company) {
          (current as any).company = line;
        } else if (!(current as any).role) {
          (current as any).role = line;
        } else {
          newEntry({ company: line });
        }
      }
      continue;
    }

    if (line.length > 5 && current) {
      (current as any).description =
        ((current as any).description ? (current as any).description + " " : "") + line;
    }
  }

  flush();
  return experience;
}

function parseProjectsSection(lines: string[]): ParsedSection["projects"] {
  const projects: ParsedSection["projects"] = [];
  let cur: Partial<ParsedSection["projects"][0]> | null = null;
  const normalizedLines = coalesceProjectLines(lines);

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

  for (const rawLine of normalizedLines) {
    const line = cleanLine(rawLine);
    if (!line || looksLikeSectionHeader(line)) continue;

    const titleAndDescription = splitTitleAndDescription(line);
    if (
      titleAndDescription &&
      titleAndDescription.title.length <= 140 &&
      !PROJECT_LABEL_RE.test(titleAndDescription.title) &&
      !DEGREE_RE.test(titleAndDescription.title)
    ) {
      flushProject();
      cur = {
        name: titleAndDescription.title,
        description: titleAndDescription.description,
      };
      const techMatches = [
        ...titleAndDescription.description.matchAll(
          /\b(Next\.js|React(?: Native)?|Node\.js|Express\.js|PostgreSQL|MySQL|MongoDB|Redis|BullMQ|MinIO|Supabase|Firebase|Twilio|Docker|AWS|GCP|TypeScript|JavaScript|Python|Java|Kotlin|Expo|WebSockets|Power BI|Tally ERP(?: 9\/Prime)?|Excel|Microsoft Excel)\b/gi
        ),
      ].map((match) => match[0]);
      if (techMatches.length > 0) {
        cur.technologies = dedupeStrings(techMatches);
      }
      continue;
    }

    const titleWithDuration =
      parseDateRange(line) && !ACTION_VERBS_RE.test(line) && !PROJECT_LABEL_RE.test(line)
        ? stripDateRange(line)
        : "";
    if (titleWithDuration && titleWithDuration.length >= 3 && titleWithDuration.length <= 140) {
      flushProject();
      cur = {
        name: titleWithDuration.trim().replace(/\s+[–—-]\s+$/, ""),
        description: "",
        duration: line.match(PARTIAL_DATE_RANGE_RE)?.[0] || undefined,
      };
      continue;
    }

    if (DATE_RANGE_RE.test(line) || PARTIAL_DATE_RANGE_RE.test(line)) {
      if (cur) cur.duration = line.match(PARTIAL_DATE_RANGE_RE)?.[0] || line;
      continue;
    }

    if (/^(technologies?|tech(?:\s+stack)?|built\s+with|tools?|stack)\s*:/i.test(line)) {
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

    if (BULLET_RE.test(line)) {
      if (cur) {
        cur.description =
          (cur.description ? cur.description + " " : "") + line.replace(BULLET_RE, "").trim();
      }
      continue;
    }

    const looksLikeTitle =
      line.length > 3 &&
      line.length <= 120 &&
      !DEGREE_RE.test(line) &&
      !INSTITUTION_RE.test(line) &&
      !ACTION_VERBS_RE.test(line) &&
      line[0] === line[0].toUpperCase() &&
      !line.startsWith("http") &&
      !PROJECT_LINK_RE.test(line) &&
      !PROJECT_LABEL_RE.test(line);

    const looksLikeDescription =
      line.length > 80 ||
      /^(this|the|a |an |i |we |it |built\s)/i.test(line) ||
      ACTION_VERBS_RE.test(line);

    if (looksLikeTitle && !looksLikeDescription && (!cur || line !== cur.name)) {
      flushProject();
      cur = {
        name: stripDateRange(line)
          .replace(/\s+[–—\-]\s+$/, "")
          .trim(),
        description: "",
      };
      const duration = parseDateRange(line);
      if (duration) {
        cur.duration = line.match(PARTIAL_DATE_RANGE_RE)?.[0] || undefined;
      }
    } else if (cur && line.length > 5) {
      if (PROJECT_LINK_RE.test(line)) continue;
      if (/^(tech(?:\s+stack)?|stack)\s*:/i.test(line)) {
        cur.technologies = line
          .split(":")
          .slice(1)
          .join(":")
          .split(/[,;]/)
          .map((token) => token.trim())
          .filter(Boolean);
        continue;
      }
      const techMatches = [
        ...line.matchAll(
          /\b(Next\.js|React(?: Native)?|Node\.js|Express\.js|PostgreSQL|MySQL|MongoDB|Redis|BullMQ|MinIO|Supabase|Firebase|Twilio|Docker|AWS|GCP|TypeScript|JavaScript|Python|Java|Kotlin|Expo|WebSockets)\b/gi
        ),
      ].map((match) => match[0]);
      if (techMatches.length > 0) {
        cur.technologies = dedupeStrings([...(cur.technologies || []), ...techMatches]);
      }
      cur.description = (cur.description ? cur.description + " " : "") + line;
    }
  }

  flushProject();
  return projects;
}

function parseEducationSection(lines: string[]): ParsedSection["education"] {
  const education: ParsedSection["education"] = [];

  let pendingDegree: string | null = null;
  let pendingInstitution: string | null = null;
  let pendingGpa: string | null = null;
  let pendingDate: string | null = null;
  let pendingNotes: string[] = [];

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
        field: pendingNotes.length > 0 ? pendingNotes.join(" ") : undefined,
      });
    }
    pendingDegree = null;
    pendingInstitution = null;
    pendingGpa = null;
    pendingDate = null;
    pendingNotes = [];
  }

  for (const line of lines) {
    const trimmed = cleanLine(line);
    if (!trimmed || looksLikeSectionHeader(trimmed)) continue;
    if (EDUCATION_SECTION_BOUNDARY_RE.test(trimmed)) {
      commitEntry();
      break;
    }
    if (
      trimmed.length > 180 &&
      /^(tax\s*&\s*compliance|accounting\s*&\s*finance|technical\s+skills)\s*:/i.test(trimmed)
    ) {
      commitEntry();
      break;
    }

    const dateInParensMatch = line.match(EDUCATION_DATE_IN_PARENS);
    let lineWithoutEndDate = line;
    let extractedEndDate: string | null = null;
    if (dateInParensMatch) {
      extractedEndDate = dateInParensMatch[1].trim();
      lineWithoutEndDate = line.replace(EDUCATION_DATE_IN_PARENS, "").trim();
    }

    if (
      pendingDegree &&
      INSTITUTION_RE.test(trimmed) &&
      (trimmed.includes("•") || trimmed.length > 50)
    ) {
      const bulletParts = trimmed
        .split(/\s*[•]\s*/)
        .map((part) => part.trim())
        .filter(Boolean);
      const institutionPart = (bulletParts[0] || "").trim().replace(GPA_RE, "").trim();
      if (institutionPart.length >= 5 && institutionPart.length <= 120) {
        pendingInstitution = institutionPart;
        if (bulletParts.length > 1) {
          pendingNotes.push(...bulletParts.slice(1));
        }
        commitEntry();
        continue;
      }
    }

    const degreeThenDateCandidate = parseDateRange(trimmed) ? stripDateRange(trimmed) : "";
    if (degreeThenDateCandidate && DEGREE_RE.test(degreeThenDateCandidate)) {
      commitEntry();
      pendingDegree = degreeThenDateCandidate.replace(GPA_RE, "").trim();
      const parsedDate = parseDateRange(trimmed);
      pendingDate = parsedDate?.endDate || parsedDate?.startDate || null;
      continue;
    }

    if (
      pendingDegree &&
      !pendingInstitution &&
      (INSTITUTION_RE.test(trimmed) || /,\s*[A-Z][a-z]+/.test(trimmed))
    ) {
      pendingInstitution = trimmed.replace(GPA_RE, "").trim();
      const gpaMatchInline = trimmed.match(GPA_RE);
      if (gpaMatchInline) {
        pendingGpa = gpaMatchInline[2]
          ? `${gpaMatchInline[1]}/${gpaMatchInline[2]}`
          : gpaMatchInline[1];
      }
      commitEntry();
      continue;
    }

    if (pendingDegree && /^[•*-]\s+/.test(line)) {
      pendingNotes.push(line.replace(/^[•*-]\s+/, "").trim());
      continue;
    }

    if (
      pendingDegree &&
      !pendingInstitution &&
      !DEGREE_RE.test(trimmed) &&
      !looksLikeSectionHeader(trimmed) &&
      (INSTITUTION_RE.test(trimmed) || trimmed.length <= 120)
    ) {
      pendingInstitution = trimmed.replace(GPA_RE, "").trim();
      const gpaMatchInline = trimmed.match(GPA_RE);
      if (gpaMatchInline) {
        pendingGpa = gpaMatchInline[2]
          ? `${gpaMatchInline[1]}/${gpaMatchInline[2]}`
          : gpaMatchInline[1];
      }
      if (
        /^(ca\s+foundation|ca\s+intermediate|specialized\s+in|key\s+subjects|percentage)\b/i.test(
          pendingInstitution
        )
      ) {
        pendingNotes.push(pendingInstitution);
        pendingInstitution = "";
      }
      continue;
    }

    const institutionDegreeMatch = lineWithoutEndDate.match(INSTITUTION_THEN_DEGREE_RE);
    const skipInstitutionDegreeMatch =
      institutionDegreeMatch &&
      (institutionDegreeMatch[2] || "").toLowerCase() === "foundation" &&
      /^[\s:]|cleared|attempted/i.test((institutionDegreeMatch[3] || "").trim());
    if (
      institutionDegreeMatch &&
      INSTITUTION_RE.test(institutionDegreeMatch[1]) &&
      !skipInstitutionDegreeMatch
    ) {
      const degreeWord = (institutionDegreeMatch[2] || "").trim();
      const degreeRest = (institutionDegreeMatch[3] || "").trim().replace(GPA_RE, "").trim();
      const institution = institutionDegreeMatch[1].trim().replace(GPA_RE, "").trim();
      const degree = degreeRest ? `${degreeWord} ${degreeRest}`.trim() : degreeWord;
      const gradDate =
        extractedEndDate && PARTIAL_DATE_RANGE_RE.test(extractedEndDate)
          ? parseDateRange(extractedEndDate)?.endDate ||
            parseDateRange(extractedEndDate)?.startDate ||
            extractedEndDate
          : extractedEndDate;
      commitEntry();
      education.push({
        institution,
        degree: degree.replace(/,?\s*(19|20)\d{2}.*$/, "").trim(),
        graduationDate: gradDate || undefined,
        gpa: undefined,
      });
      continue;
    }

    const gpaMatch = line.match(GPA_RE);
    if (gpaMatch && !pendingGpa) {
      pendingGpa = gpaMatch[2] ? `${gpaMatch[1]}/${gpaMatch[2]}` : gpaMatch[1];
    }

    const dateRangeInLine = line.match(PARTIAL_DATE_RANGE_RE);
    if (dateRangeInLine && !pendingDate) {
      const parsedDate = parseDateRange(line);
      pendingDate = parsedDate?.endDate || parsedDate?.startDate || null;
    }
    if (extractedEndDate && !pendingDate) {
      const exDate = extractedEndDate.match(PARTIAL_DATE_RANGE_RE);
      if (exDate) pendingDate = exDate[1]?.trim() || null;
    }
    const yearMatch = line.match(YEAR_RE);
    if (yearMatch && !pendingDate) {
      pendingDate = yearMatch[1];
    }

    const lineWithoutDate = dateRangeInLine
      ? line.replace(PARTIAL_DATE_RANGE_RE, " ").replace(/\s+/g, " ").trim()
      : line.replace(EDUCATION_DATE_IN_PARENS, "").trim();
    const hasDegree = DEGREE_RE.test(lineWithoutDate);
    const hasInstitution = INSTITUTION_RE.test(lineWithoutDate);

    if (hasDegree && !hasInstitution) {
      if (pendingDegree) {
        commitEntry();
      }
      pendingDegree = lineWithoutDate.replace(GPA_RE, "").trim();
      const higherSecondaryMatch = pendingDegree.match(
        /^(Higher\s+Secondary\s+Education)\s+(.+)$/i
      );
      if (higherSecondaryMatch) {
        pendingDegree = higherSecondaryMatch[1].trim();
        pendingInstitution = higherSecondaryMatch[2].trim();
      }
    } else if (hasInstitution && !hasDegree) {
      if (pendingInstitution && !pendingDegree) {
        commitEntry();
      }
      let institutionLine = lineWithoutDate.replace(GPA_RE, "").trim();
      const keySubjectsMatch = institutionLine.match(/\b(Key\s+Subjects)\s*:\s*(.+)$/i);
      const percentageMatch = institutionLine.match(/\b(Percentage)\s*:\s*(.+)$/i);
      if (keySubjectsMatch) {
        pendingNotes.push(`${keySubjectsMatch[1]}: ${keySubjectsMatch[2]}`.trim());
      }
      if (percentageMatch) {
        pendingNotes.push(`${percentageMatch[1]}: ${percentageMatch[2]}`.trim());
      }
      institutionLine = institutionLine
        .replace(/\s*(CGPA|Key\s+Subjects|Percentage)\s*:.*$/i, "")
        .trim();
      pendingInstitution =
        pendingInstitution && pendingDegree
          ? `${pendingInstitution} ${institutionLine}`.trim()
          : institutionLine;
      if (pendingDegree) {
        commitEntry();
      }
    } else if (
      pendingDegree &&
      /^(ca\s+foundation|ca\s+intermediate|specialized\s+in|key\s+subjects|percentage)\b/i.test(
        trimmed
      )
    ) {
      pendingNotes.push(trimmed);
    } else if (hasDegree && hasInstitution) {
      commitEntry();

      if (dateRangeInLine) {
        const before = line.replace(PARTIAL_DATE_RANGE_RE, "\x00").split("\x00")[0].trim();
        const after = line.replace(PARTIAL_DATE_RANGE_RE, "\x00").split("\x00")[1]?.trim() || "";
        if (DEGREE_RE.test(before) && INSTITUTION_RE.test(after)) {
          pendingDegree = before.replace(GPA_RE, "").trim();
          pendingInstitution = after.replace(GPA_RE, "").trim();
          commitEntry();
          continue;
        }
      }

      const atIdx = lineWithoutDate.search(/\b(at|from)\b/i);
      const commaIdx = lineWithoutDate.indexOf(",");

      if (atIdx > 0) {
        pendingDegree = lineWithoutDate.substring(0, atIdx).trim().replace(GPA_RE, "").trim();
        pendingInstitution = lineWithoutDate
          .substring(atIdx + 2)
          .trim()
          .replace(GPA_RE, "")
          .trim();
      } else if (commaIdx > 0) {
        pendingDegree = lineWithoutDate.substring(0, commaIdx).trim().replace(GPA_RE, "").trim();
        pendingInstitution = lineWithoutDate
          .substring(commaIdx + 1)
          .trim()
          .replace(GPA_RE, "")
          .trim();
      } else {
        pendingDegree = lineWithoutDate.replace(GPA_RE, "").trim();
        pendingInstitution = lineWithoutDate.replace(GPA_RE, "").trim();
      }
      commitEntry();
    }
  }

  commitEntry();

  return education;
}

function parseCertificationsSection(lines: string[]): NonNullable<ParsedSection["certifications"]> {
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

export function parseResumeTextEnhanced(text: string): ParsedSection {
  const normalized = normalizeResumeText(text);
  const lines = normalized
    .split("\n")
    .map((l) => cleanLine(l))
    .filter(Boolean);

  const sections = findSections(lines);

  const experienceLines = [
    ...getSectionLines(lines, sections, "experience"),
    ...getSectionLines(lines, sections, "additional_experience"),
  ];
  return {
    skills: parseSkillsSection(getSectionLines(lines, sections, "skills")),
    experience: parseExperienceSection(experienceLines),
    projects: parseProjectsSection(getSectionLines(lines, sections, "projects")),
    education: parseEducationSection(getSectionLines(lines, sections, "education")),
    certifications: parseCertificationsSection(getSectionLines(lines, sections, "certifications")),
    rawText: text,
  };
}
