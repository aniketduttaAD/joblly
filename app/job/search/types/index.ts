export interface Resume {
  id: string;
  name: string;
  content: string;
  parsedContent: ParsedResume;
  isVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  previewUrl?: string;
  sourceFileName?: string;
  fileSize?: number;
}

export interface ParsedResume {
  skills: string[];
  experience: Experience[];
  projects: Project[];
  education: Education[];
  rawText: string;
}

export interface Experience {
  company: string;
  role: string;
  startDate: string;
  endDate?: string;
  description: string;
  achievements?: string[];
}

export interface Project {
  name: string;
  description: string;
  technologies?: string[];
  duration?: string;
}

export interface Education {
  institution: string;
  degree: string;
  field?: string;
  graduationDate?: string;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
}
