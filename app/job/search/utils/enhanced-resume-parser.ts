/**
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

export function parseResumeTextEnhanced(text: string): ParsedSection {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const skills: string[] = [];
  let inSkillsSection = false;
  let skillsEnded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    const isSkillsHeader =
      lowerLine === "technical skills" ||
      lowerLine === "skills" ||
      lowerLine.match(/^(technical\s+)?skills$/i);
    if (!skillsEnded && isSkillsHeader && lowerLine.length < 30) {
      inSkillsSection = true;
      continue;
    }

    if (inSkillsSection) {
      const isMajorSection = lowerLine.match(
        /^(work experience|experience|employment|work history|education|projects|certifications|professional summary|summary)$/
      );
      if (isMajorSection && lowerLine.length < 30 && !line.includes(":")) {
        inSkillsSection = false;
        skillsEnded = true;
        continue;
      }
    }

    if (inSkillsSection && line.length > 0) {
      if (line.includes(":")) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          const skillList = parts
            .slice(1)
            .join(":")
            .split(/[,•\-\n|;]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length < 50 && !s.match(/^(and|or|the|a|an)$/i));
          skills.push(...skillList);
        }
      } else {
        const skillList = line
          .split(/[,•\-\n|;]/)
          .map((s) => s.trim())
          .filter(
            (s) =>
              s.length > 0 &&
              s.length < 50 &&
              !s.match(/^(and|or|the|a|an| languages|frontend|backend|devops|core)$/i)
          );
        skills.push(...skillList);
      }
    }
  }

  const experience: ParsedSection["experience"] = [];
  const experienceKeywords = [
    "work experience",
    "experience",
    "employment",
    "work history",
    "professional experience",
    "career",
  ];

  let inExperienceSection = false;
  let currentExp: Partial<ParsedSection["experience"][0]> | null = null;
  let lastSavedExpKey: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    if (
      experienceKeywords.some((keyword) => lowerLine.includes(keyword)) &&
      lowerLine.length < 30
    ) {
      inExperienceSection = true;
      continue;
    }

    if (inExperienceSection) {
      const datePattern = /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i;
      const dateMatch = line.match(datePattern);

      const roleCompanyPattern = /^([^•]{2,50})\s*•\s*(.{2,50})$/;
      const roleCompanyMatch = line.length < 80 && line.match(roleCompanyPattern);

      const isDatePatternForAt =
        /^(\w+\s+\d{4}|\d{4})\s+at\s+(\w+\s+\d{4}|\d{4}|present|current)$/i.test(line);
      const roleAtCompanyPattern = /^(.{2,50}?)\s+at\s+(.{2,50})$/i;
      const roleAtCompanyMatch =
        line.length < 80 && !isDatePatternForAt && line.match(roleAtCompanyPattern);

      const actionVerbs =
        /^(rebuilt|developed|created|implemented|designed|migrated|integrated|built)/i;
      const isDatePattern =
        /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i.test(line);
      const roleDashCompanyPattern = /^(.{2,50}?)\s+[-–—]\s+(.{2,50})$/;
      const roleDashCompanyMatch =
        line.length < 80 &&
        !actionVerbs.test(line) &&
        !isDatePattern &&
        line.match(roleDashCompanyPattern);

      const isNewEntry = roleCompanyMatch || roleAtCompanyMatch || roleDashCompanyMatch;

      if (isNewEntry) {
        if (currentExp && (currentExp.role || currentExp.company)) {
          const expKey = `${currentExp.role}|||${currentExp.company}`;
          if (expKey !== lastSavedExpKey) {
            experience.push({
              company: currentExp.company || "",
              role: currentExp.role || "",
              startDate: currentExp.startDate || "",
              endDate: currentExp.endDate,
              description: currentExp.description || "",
              achievements: currentExp.achievements,
            });
            lastSavedExpKey = expKey;
          }
        }

        if (roleCompanyMatch) {
          currentExp = {
            role: roleCompanyMatch[1].trim(),
            company: roleCompanyMatch[2].trim(),
            startDate: "",
            endDate: undefined,
            description: "",
            achievements: [],
          };
        } else if (roleAtCompanyMatch) {
          currentExp = {
            role: roleAtCompanyMatch[1].trim(),
            company: roleAtCompanyMatch[2].trim(),
            startDate: "",
            endDate: undefined,
            description: "",
            achievements: [],
          };
        } else if (roleDashCompanyMatch) {
          currentExp = {
            role: roleDashCompanyMatch[1].trim(),
            company: roleDashCompanyMatch[2].trim(),
            startDate: "",
            endDate: undefined,
            description: "",
            achievements: [],
          };
        }
      } else if (currentExp) {
        if (dateMatch) {
          if (!currentExp.startDate || currentExp.startDate === "") {
            currentExp.startDate = dateMatch[1]?.trim() || "";
            const endDateValue = dateMatch[2];
            currentExp.endDate =
              endDateValue &&
              endDateValue.toLowerCase() !== "present" &&
              endDateValue.toLowerCase() !== "current"
                ? endDateValue.trim()
                : undefined;
          }
        } else if (line.length > 10 && !dateMatch) {
          if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
            if (!currentExp.achievements) currentExp.achievements = [];
            currentExp.achievements.push(line.replace(/^[•\-\*]\s*/, ""));
          } else {
            currentExp.description += (currentExp.description ? " " : "") + line;
          }
        }
      }

      const isMajorSection = lowerLine.match(/^(education|projects|certifications|key projects)$/);
      if (isMajorSection && lowerLine.length < 30) {
        if (currentExp && (currentExp.role || currentExp.company)) {
          const expKey = `${currentExp.role}|||${currentExp.company}`;
          if (expKey !== lastSavedExpKey) {
            experience.push({
              company: currentExp.company || "",
              role: currentExp.role || "",
              startDate: currentExp.startDate || "",
              endDate: currentExp.endDate,
              description: currentExp.description || "",
              achievements: currentExp.achievements,
            });
            lastSavedExpKey = expKey;
          }
        }
        currentExp = null;
        break;
      }
    }
  }

  if (currentExp && (currentExp.role || currentExp.company)) {
    const expKey = `${currentExp.role}|||${currentExp.company}`;
    if (expKey !== lastSavedExpKey) {
      experience.push({
        company: currentExp.company || "",
        role: currentExp.role || "",
        startDate: currentExp.startDate || "",
        endDate: currentExp.endDate,
        description: currentExp.description || "",
        achievements: currentExp.achievements,
      });
    }
  }

  const projects: ParsedSection["projects"] = [];
  const projectKeywords = ["key projects", "projects", "project", "portfolio", "side projects"];

  let inProjectsSection = false;
  let currentProject: Partial<ParsedSection["projects"][0]> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    if (
      projectKeywords.some((keyword) => lowerLine === keyword || lowerLine === `key ${keyword}`) &&
      lowerLine.length < 30
    ) {
      inProjectsSection = true;
      continue;
    }

    if (inProjectsSection && (lowerLine === "education" || lowerLine.startsWith("education"))) {
      if (currentProject && currentProject.name) {
        projects.push({
          name: currentProject.name,
          description: currentProject.description || "",
          technologies: currentProject.technologies,
          duration: currentProject.duration,
        });
      }
      break;
    }

    if (inProjectsSection) {
      const isDegree = /(bachelor|master|phd|doctorate|associate|diploma|certificate)/i.test(line);
      const isDateOnly =
        /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i.test(line);

      if (
        line.length > 5 &&
        line.length < 80 &&
        line[0] === line[0].toUpperCase() &&
        !line.includes(":") &&
        !isDegree &&
        !isDateOnly &&
        !line.toLowerCase().includes("university") &&
        !line.toLowerCase().includes("college") &&
        (!currentProject || line !== currentProject.name)
      ) {
        if (currentProject && currentProject.name) {
          projects.push({
            name: currentProject.name,
            description: currentProject.description || "",
            technologies: currentProject.technologies,
            duration: currentProject.duration,
          });
        }
        currentProject = { name: line, description: "" };
      } else if (currentProject && line.length > 10) {
        const dateMatch = line.match(
          /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i
        );
        if (dateMatch) {
          currentProject.duration = line;
        } else if (line.includes("Technologies:") || line.includes("Tech:")) {
          const techs =
            line
              .split(/[:;]/)[1]
              ?.split(",")
              .map((t) => t.trim()) || [];
          currentProject.technologies = techs;
        } else {
          currentProject.description += (currentProject.description ? " " : "") + line;
        }
      }
    }
  }

  if (currentProject && currentProject.name) {
    const isDuplicate = projects.some((p) => p.name === currentProject.name);
    if (!isDuplicate) {
      projects.push({
        name: currentProject.name,
        description: currentProject.description || "",
        technologies: currentProject.technologies,
        duration: currentProject.duration,
      });
    }
  }

  const education: ParsedSection["education"] = [];
  const educationKeywords = ["education", "academic", "qualifications"];

  let inEducationSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    if (educationKeywords.some((keyword) => lowerLine.includes(keyword))) {
      inEducationSection = true;
      continue;
    }

    if (inEducationSection) {
      const degreePattern = /(bachelor|master|phd|doctorate|associate|diploma|certificate)/i;
      const institutionPattern = /(university|college|institute|school)/i;

      if (degreePattern.test(line) || institutionPattern.test(line)) {
        const parts = line.split(/\s+-\s+|\s+,\s+/);
        const degreeMatch = line.match(
          /([A-Z][^,]+(?:Bachelor|Master|PhD|Doctorate|Associate|Diploma|Certificate)[^,]*)/i
        );
        const institutionMatch = line.match(
          /(?:from|at)\s+([A-Z][^,]+(?:University|College|Institute|School)[^,]*)/i
        );
        const dateMatch = line.match(/(\d{4})/);

        education.push({
          degree: degreeMatch ? degreeMatch[1].trim() : parts[0] || "",
          institution: institutionMatch
            ? institutionMatch[1].trim()
            : parts[parts.length - 1] || "",
          graduationDate: dateMatch ? dateMatch[1] : undefined,
        });
      }
    }
  }

  const uniqueSkills = [...new Set(skills)].filter((s) => s.length > 0);

  return {
    skills: uniqueSkills,
    experience,
    projects,
    education,
    rawText: text,
  };
}
