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

export interface JobDescription {
  id: string;
  chatId: string;
  content: string;
  extracted: ExtractedJD;
  createdAt: Date;
}

export interface ExtractedJD {
  roleTitle: string;
  requiredSkills: string[];
  preferredSkills: string[];
  responsibilities: string[];
  company?: string;
}

export interface Chat {
  id: string;
  resumeId: string;
  jdId: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Message {
  id: string;
  chatId?: string;
  role: "user" | "assistant";
  content: string;
  extraInstructions?: string;
  timestamp: Date;
  contextSummary?: ContextSummary;
}

export interface ContextSummary {
  resumeSections: string[];
  jdRequirements: string[];
}

export interface ChatCreationState {
  selectedResumeId: string | null;
  jdText: string;
  isConfirmed: boolean;
}

export interface LLMResponse {
  content: string;
  tokensUsed?: number;
  model?: string;
}
