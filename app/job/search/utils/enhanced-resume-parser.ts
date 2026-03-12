/**
 * Enhanced resume parsing with better NLP extraction
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

/**
 * Enhanced parsing with better pattern recognition
 */
export function parseResumeTextEnhanced(text: string): ParsedSection {
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  // Extract skills with better pattern matching
  const skills: string[] = [];
  let inSkillsSection = false;
  let skillsEnded = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Detect skills section start - must be a section header, not a job title
    // Check for exact matches or "Technical Skills" pattern
    const isSkillsHeader =
      lowerLine === "technical skills" ||
      lowerLine === "skills" ||
      lowerLine.match(/^(technical\s+)?skills$/i);
    if (!skillsEnded && isSkillsHeader && lowerLine.length < 30) {
      inSkillsSection = true;
      continue;
    }

    // Detect skills section end - check for major section headers (but not if it's part of a skill category)
    if (inSkillsSection) {
      // Only end if it's a standalone section header, not if it contains a colon (which would be a skill category)
      const isMajorSection = lowerLine.match(
        /^(work experience|experience|employment|work history|education|projects|certifications|professional summary|summary)$/
      );
      if (isMajorSection && lowerLine.length < 30 && !line.includes(":")) {
        inSkillsSection = false;
        skillsEnded = true;
        continue;
      }
    }

    // Extract skills from current line
    if (inSkillsSection && line.length > 0) {
      // Handle categorized skills like "Languages:JavaScript, TypeScript, Java"
      // or "Frontend & Mobile:React, Next.js, React Native"
      if (line.includes(":")) {
        const parts = line.split(":");
        if (parts.length >= 2) {
          // Extract skills after the colon
          const skillList = parts
            .slice(1)
            .join(":")
            .split(/[,•\-\n|;]/)
            .map((s) => s.trim())
            .filter((s) => s.length > 0 && s.length < 50 && !s.match(/^(and|or|the|a|an)$/i));
          skills.push(...skillList);
        }
      } else {
        // Handle comma-separated, bullet points, or other formats
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

  // Extract experience with better pattern recognition
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
  let lastSavedExpKey: string | null = null; // Track last saved entry to avoid duplicates

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Detect experience section
    if (
      experienceKeywords.some((keyword) => lowerLine.includes(keyword)) &&
      lowerLine.length < 30
    ) {
      inExperienceSection = true;
      continue;
    }

    if (inExperienceSection) {
      // Detect date pattern (e.g., "Jun 2025 – Sep 2025" or "Jan 2024 – Jun 2025")
      // Must be a standalone date line, not part of a longer description
      const datePattern = /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i;
      const dateMatch = line.match(datePattern);

      // Detect role • company pattern (e.g., "Full Stack Developer • Heal Easy")
      // Must be a short line (likely a title), not a long description
      const roleCompanyPattern = /^([^•]{2,50})\s*•\s*(.{2,50})$/;
      const roleCompanyMatch = line.length < 80 && line.match(roleCompanyPattern);

      // Detect role at company pattern (must be short, not a description)
      // Exclude date patterns (they're dates, not role/company)
      const isDatePatternForAt =
        /^(\w+\s+\d{4}|\d{4})\s+at\s+(\w+\s+\d{4}|\d{4}|present|current)$/i.test(line);
      const roleAtCompanyPattern = /^(.{2,50}?)\s+at\s+(.{2,50})$/i;
      const roleAtCompanyMatch =
        line.length < 80 && !isDatePatternForAt && line.match(roleAtCompanyPattern);

      // Detect role - company pattern (must be short, not a description with dashes)
      // Exclude lines that start with action verbs (they're descriptions)
      // Exclude date patterns (they're dates, not role/company)
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

      // Check if this is a new experience entry
      // A date alone is NOT a new entry - it should update the current entry
      const isNewEntry = roleCompanyMatch || roleAtCompanyMatch || roleDashCompanyMatch;

      if (isNewEntry) {
        // Save previous experience if exists
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

        // Start new experience
        if (roleCompanyMatch) {
          // Format: "Role • Company"
          currentExp = {
            role: roleCompanyMatch[1].trim(),
            company: roleCompanyMatch[2].trim(),
            startDate: "",
            endDate: undefined,
            description: "",
            achievements: [],
          };
        } else if (roleAtCompanyMatch) {
          // Format: "Role at Company"
          currentExp = {
            role: roleAtCompanyMatch[1].trim(),
            company: roleAtCompanyMatch[2].trim(),
            startDate: "",
            endDate: undefined,
            description: "",
            achievements: [],
          };
        } else if (roleDashCompanyMatch) {
          // Format: "Role - Company"
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
        // Check if this is a date line for existing experience (dates come after role/company)
        if (dateMatch) {
          // Only update dates if they're not already set, or if current dates are empty
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
          // Add to description or achievements (but not if it's a date line)
          if (line.startsWith("•") || line.startsWith("-") || line.startsWith("*")) {
            if (!currentExp.achievements) currentExp.achievements = [];
            currentExp.achievements.push(line.replace(/^[•\-\*]\s*/, ""));
          } else {
            currentExp.description += (currentExp.description ? " " : "") + line;
          }
        }
      }

      // End experience section - check for major section headers
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
        currentExp = null; // Clear currentExp to prevent saving again
        break;
      }
    }
  }

  // Save last experience if exists (only if not already saved)
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

  // Extract projects
  const projects: ParsedSection["projects"] = [];
  const projectKeywords = ["key projects", "projects", "project", "portfolio", "side projects"];

  let inProjectsSection = false;
  let currentProject: Partial<ParsedSection["projects"][0]> | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lowerLine = line.toLowerCase();

    // Only start projects section if it's a clear section header
    if (
      projectKeywords.some((keyword) => lowerLine === keyword || lowerLine === `key ${keyword}`) &&
      lowerLine.length < 30
    ) {
      inProjectsSection = true;
      continue;
    }

    // End projects section when we hit education
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
      // Project names: must be capitalized, not too long, and not contain degree keywords
      const isDegree = /(bachelor|master|phd|doctorate|associate|diploma|certificate)/i.test(line);
      const isDateOnly =
        /^(\w+\s+\d{4}|\d{4})\s*[-–—]\s*(\w+\s+\d{4}|\d{4}|present|current)$/i.test(line);

      // Project name pattern: capitalized, reasonable length, not a degree, not just a date
      // Must not be a duplicate of current project name
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
        // Check for date pattern for duration
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
    // Check if this project is already in the list (avoid duplicates)
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

  // Extract education
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
      // Education entries usually have degree, institution, and optionally date
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
