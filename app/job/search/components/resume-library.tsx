"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, FileText, Loader2, Plus, Trash2, Upload } from "lucide-react";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import { fetchWithAuth } from "@/lib/auth-client";
import { sfn } from "@/lib/supabase-api";
import { Button } from "@/app/job/search/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/job/search/components/ui/card";
import { Input } from "@/app/job/search/components/ui/input";
import { Textarea } from "@/app/job/search/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/job/search/components/ui/dialog";
import type { ParsedResume, Resume } from "@/app/job/search/types";
import { extractTextFromPdf } from "@/app/job/search/utils/pdf-text";
import { parseResumeTextEnhanced } from "@/app/job/search/utils/resume-parser";

function formatBytes(value?: number): string {
  if (!value || value <= 0) return "Unknown size";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function emptyStateMessage(compact: boolean): string {
  return compact
    ? "Upload a PDF resume here to use it across the app."
    : "No resumes yet. Upload your first PDF resume to get started.";
}

type ResumeEditorState = {
  rawText: string;
  skills: string[];
  experience: ParsedResume["experience"];
  projects: ParsedResume["projects"];
  education: ParsedResume["education"];
};

type ValidationIssue = {
  path: string;
  message: string;
};

function parsedResumeToEditorState(
  parsedContent: ParsedResume,
  content?: string
): ResumeEditorState {
  return {
    rawText: content ?? parsedContent.rawText ?? "",
    skills: parsedContent.skills,
    experience: parsedContent.experience,
    projects: parsedContent.projects,
    education: parsedContent.education,
  };
}

function editorStateToParsedResume(state: ResumeEditorState): ParsedResume {
  return {
    rawText: state.rawText.trim(),
    skills: state.skills.map((skill) => skill.trim()).filter(Boolean),
    experience: state.experience.map((entry) => ({
      ...entry,
      company: entry.company.trim(),
      role: entry.role.trim(),
      startDate: entry.startDate.trim(),
      endDate: entry.endDate?.trim() || undefined,
      description: entry.description.trim(),
      achievements: (entry.achievements || []).map((item) => item.trim()).filter(Boolean),
    })),
    projects: state.projects.map((project) => ({
      ...project,
      name: project.name.trim(),
      description: project.description.trim(),
      duration: project.duration?.trim() || undefined,
      technologies: (project.technologies || []).map((item) => item.trim()).filter(Boolean),
    })),
    education: state.education.map((entry) => ({
      ...entry,
      degree: entry.degree.trim(),
      institution: entry.institution.trim(),
      field: entry.field?.trim() || undefined,
      graduationDate: entry.graduationDate?.trim() || undefined,
    })),
  };
}

function updateListItem<T>(items: T[], index: number, updater: (item: T) => T): T[] {
  return items.map((item, itemIndex) => (itemIndex === index ? updater(item) : item));
}

function removeListItem<T>(items: T[], index: number): T[] {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function getFieldError(issues: ValidationIssue[], ...paths: string[]): string | null {
  const match = issues.find((issue) => paths.some((path) => issue.path === path));
  return match?.message || null;
}

function fieldClassName(hasError: boolean): string {
  return hasError ? "border-red-400 focus-visible:ring-red-300" : "";
}

function validateResumeEditorState(state: ResumeEditorState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!state.rawText.trim()) {
    issues.push({ path: "rawText", message: "Raw extracted text is required." });
  }

  state.skills.forEach((skill, index) => {
    if (!skill.trim()) {
      issues.push({ path: `skills.${index}`, message: `Skill #${index + 1} cannot be empty.` });
    }
  });

  state.experience.forEach((entry, index) => {
    if (!entry.company.trim()) {
      issues.push({
        path: `experience.${index}.company`,
        message: `Experience #${index + 1}: company is required.`,
      });
    }
    if (!entry.role.trim()) {
      issues.push({
        path: `experience.${index}.role`,
        message: `Experience #${index + 1}: role is required.`,
      });
    }
    if (!entry.description.trim()) {
      issues.push({
        path: `experience.${index}.description`,
        message: `Experience #${index + 1}: description is required.`,
      });
    }
    (entry.achievements || []).forEach((achievement, achievementIndex) => {
      if (!achievement.trim()) {
        issues.push({
          path: `experience.${index}.achievements.${achievementIndex}`,
          message: `Experience #${index + 1}: achievement #${achievementIndex + 1} cannot be empty.`,
        });
      }
    });
  });

  state.projects.forEach((project, index) => {
    if (!project.name.trim()) {
      issues.push({
        path: `projects.${index}.name`,
        message: `Project #${index + 1}: name is required.`,
      });
    }
    if (!project.description.trim()) {
      issues.push({
        path: `projects.${index}.description`,
        message: `Project #${index + 1}: description is required.`,
      });
    }
    (project.technologies || []).forEach((technology, technologyIndex) => {
      if (!technology.trim()) {
        issues.push({
          path: `projects.${index}.technologies.${technologyIndex}`,
          message: `Project #${index + 1}: technology #${technologyIndex + 1} cannot be empty.`,
        });
      }
    });
  });

  state.education.forEach((entry, index) => {
    if (!entry.degree.trim()) {
      issues.push({
        path: `education.${index}.degree`,
        message: `Education #${index + 1}: degree is required.`,
      });
    }
    if (!entry.institution.trim()) {
      issues.push({
        path: `education.${index}.institution`,
        message: `Education #${index + 1}: institution is required.`,
      });
    }
  });

  return issues;
}

function SectionHeader({
  title,
  description,
  onAdd,
  readOnly,
  compact = false,
}: {
  title: string;
  description?: string;
  onAdd?: () => void;
  readOnly?: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <label className="text-sm font-medium text-stone-700">{title}</label>
        {description ? (
          <p className={compact ? "mt-0.5 text-[11px] text-stone-500" : "text-xs text-stone-500"}>
            {description}
          </p>
        ) : null}
      </div>
      {!readOnly && onAdd ? (
        <Button type="button" variant="outline" size="sm" onClick={onAdd}>
          <Plus className="mr-2 h-4 w-4" />
          Add
        </Button>
      ) : null}
    </div>
  );
}

function ParsedResumeEditor({
  state,
  onChange,
  readOnly = false,
  validationIssues = [],
  compact = false,
}: {
  state: ResumeEditorState;
  onChange: (state: ResumeEditorState) => void;
  readOnly?: boolean;
  validationIssues?: ValidationIssue[];
  compact?: boolean;
}) {
  const sectionGap = compact ? "gap-4" : "gap-6";
  const cardPadding = compact ? "p-4" : "p-5";
  const cardGap = compact ? "gap-3" : "gap-4";
  const areaClass = compact ? "min-h-[96px]" : "min-h-[110px]";

  return (
    <div className={`grid ${sectionGap}`}>
      <div className="grid gap-3">
        <SectionHeader
          title="Skills"
          description="One skill per input."
          readOnly={readOnly}
          compact={compact}
          onAdd={() => onChange({ ...state, skills: [...state.skills, ""] })}
        />
        <div className="flex flex-wrap gap-3">
          {state.skills.map((skill, index) => (
            <div
              key={`skill-${index}`}
              className="flex min-w-[220px] flex-1 items-center gap-2 rounded-xl border border-beige-300 bg-beige-50/70 p-2 sm:basis-[calc(50%-0.375rem)] xl:basis-[calc(33.333%-0.5rem)]"
            >
              <Input
                value={skill}
                onChange={(event) =>
                  onChange({
                    ...state,
                    skills: updateListItem(state.skills, index, () => event.target.value),
                  })
                }
                placeholder="Skill"
                readOnly={readOnly}
                className={fieldClassName(
                  Boolean(getFieldError(validationIssues, `skills.${index}`))
                )}
              />
              {!readOnly ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() =>
                    onChange({ ...state, skills: removeListItem(state.skills, index) })
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        {getFieldError(validationIssues, "skills") ? (
          <p className="text-sm text-red-600">{getFieldError(validationIssues, "skills")}</p>
        ) : null}
      </div>
      <div className="grid gap-3">
        <label className="text-sm font-medium text-stone-700">Raw Extracted Text</label>
        <Textarea
          value={state.rawText}
          onChange={(event) => onChange({ ...state, rawText: event.target.value })}
          className={`${compact ? "min-h-[140px]" : "min-h-[180px]"} ${fieldClassName(Boolean(getFieldError(validationIssues, "rawText")))}`}
          placeholder="Parsed resume text will appear here."
          readOnly={readOnly}
        />
        {getFieldError(validationIssues, "rawText") ? (
          <p className="text-sm text-red-600">{getFieldError(validationIssues, "rawText")}</p>
        ) : null}
      </div>
      <div className="grid gap-3">
        <SectionHeader
          title="Experience"
          description='Structure: { "company", "role", "startDate", "description", "achievements" }'
          readOnly={readOnly}
          compact={compact}
          onAdd={() =>
            onChange({
              ...state,
              experience: [
                ...state.experience,
                {
                  company: "",
                  role: "",
                  startDate: "",
                  endDate: "",
                  description: "",
                  achievements: [],
                },
              ],
            })
          }
        />
        <div className={`grid ${cardGap}`}>
          {state.experience.map((entry, index) => (
            <div
              key={`experience-${index}`}
              className={`rounded-2xl border border-beige-300 bg-beige-50/70 ${cardPadding}`}
            >
              <div
                className={`${compact ? "mb-3" : "mb-4"} flex items-center justify-between gap-2`}
              >
                <div className="text-sm font-medium text-stone-700">Experience #{index + 1}</div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({ ...state, experience: removeListItem(state.experience, index) })
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className={`grid ${compact ? "gap-3" : "gap-4"} md:grid-cols-2`}>
                <Input
                  value={entry.company}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      experience: updateListItem(state.experience, index, (item) => ({
                        ...item,
                        company: event.target.value,
                      })),
                    })
                  }
                  placeholder="Company"
                  readOnly={readOnly}
                  className={fieldClassName(
                    Boolean(getFieldError(validationIssues, `experience.${index}.company`))
                  )}
                />
                <Input
                  value={entry.role}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      experience: updateListItem(state.experience, index, (item) => ({
                        ...item,
                        role: event.target.value,
                      })),
                    })
                  }
                  placeholder="Role"
                  readOnly={readOnly}
                  className={fieldClassName(
                    Boolean(getFieldError(validationIssues, `experience.${index}.role`))
                  )}
                />
                <Input
                  value={entry.startDate}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      experience: updateListItem(state.experience, index, (item) => ({
                        ...item,
                        startDate: event.target.value,
                      })),
                    })
                  }
                  placeholder="Start date"
                  readOnly={readOnly}
                />
                <Input
                  value={entry.endDate || ""}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      experience: updateListItem(state.experience, index, (item) => ({
                        ...item,
                        endDate: event.target.value,
                      })),
                    })
                  }
                  placeholder="End date"
                  readOnly={readOnly}
                />
              </div>
              <div className="mt-2 grid gap-1 md:grid-cols-2">
                {getFieldError(validationIssues, `experience.${index}.company`) ? (
                  <p className="text-sm text-red-600">
                    {getFieldError(validationIssues, `experience.${index}.company`)}
                  </p>
                ) : (
                  <div />
                )}
                {getFieldError(validationIssues, `experience.${index}.role`) ? (
                  <p className="text-sm text-red-600">
                    {getFieldError(validationIssues, `experience.${index}.role`)}
                  </p>
                ) : null}
              </div>
              <Textarea
                value={entry.description}
                onChange={(event) =>
                  onChange({
                    ...state,
                    experience: updateListItem(state.experience, index, (item) => ({
                      ...item,
                      description: event.target.value,
                    })),
                  })
                }
                className={`mt-4 ${areaClass} ${fieldClassName(
                  Boolean(getFieldError(validationIssues, `experience.${index}.description`))
                )}`}
                placeholder="Description"
                readOnly={readOnly}
              />
              {getFieldError(validationIssues, `experience.${index}.description`) ? (
                <p className="mt-2 text-sm text-red-600">
                  {getFieldError(validationIssues, `experience.${index}.description`)}
                </p>
              ) : null}
              <div className={`mt-4 grid ${compact ? "gap-2" : "gap-3"}`}>
                <SectionHeader
                  title="Achievements"
                  readOnly={readOnly}
                  compact={compact}
                  onAdd={() =>
                    onChange({
                      ...state,
                      experience: updateListItem(state.experience, index, (item) => ({
                        ...item,
                        achievements: [...(item.achievements || []), ""],
                      })),
                    })
                  }
                />
                {(entry.achievements || []).map((achievement, achievementIndex) => (
                  <div
                    key={`experience-${index}-achievement-${achievementIndex}`}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <Input
                      value={achievement}
                      onChange={(event) =>
                        onChange({
                          ...state,
                          experience: updateListItem(state.experience, index, (item) => ({
                            ...item,
                            achievements: updateListItem(
                              item.achievements || [],
                              achievementIndex,
                              () => event.target.value
                            ),
                          })),
                        })
                      }
                      placeholder="Achievement"
                      readOnly={readOnly}
                      className={fieldClassName(
                        Boolean(
                          getFieldError(
                            validationIssues,
                            `experience.${index}.achievements.${achievementIndex}`
                          )
                        )
                      )}
                    />
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          onChange({
                            ...state,
                            experience: updateListItem(state.experience, index, (item) => ({
                              ...item,
                              achievements: removeListItem(
                                item.achievements || [],
                                achievementIndex
                              ),
                            })),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {getFieldError(
                      validationIssues,
                      `experience.${index}.achievements.${achievementIndex}`
                    ) ? (
                      <p className="text-sm text-red-600 sm:col-span-2">
                        {getFieldError(
                          validationIssues,
                          `experience.${index}.achievements.${achievementIndex}`
                        )}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        <SectionHeader
          title="Projects"
          readOnly={readOnly}
          compact={compact}
          onAdd={() =>
            onChange({
              ...state,
              projects: [
                ...state.projects,
                { name: "", description: "", technologies: [], duration: "" },
              ],
            })
          }
        />
        <div className={`grid ${cardGap}`}>
          {state.projects.map((project, index) => (
            <div
              key={`project-${index}`}
              className={`rounded-2xl border border-beige-300 bg-beige-50/70 ${cardPadding}`}
            >
              <div
                className={`${compact ? "mb-3" : "mb-4"} flex items-center justify-between gap-2`}
              >
                <div className="text-sm font-medium text-stone-700">Project #{index + 1}</div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({ ...state, projects: removeListItem(state.projects, index) })
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className={`grid ${compact ? "gap-3" : "gap-4"} md:grid-cols-2`}>
                <Input
                  value={project.name}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      projects: updateListItem(state.projects, index, (item) => ({
                        ...item,
                        name: event.target.value,
                      })),
                    })
                  }
                  placeholder="Project name"
                  readOnly={readOnly}
                  className={fieldClassName(
                    Boolean(getFieldError(validationIssues, `projects.${index}.name`))
                  )}
                />
                <Input
                  value={project.duration || ""}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      projects: updateListItem(state.projects, index, (item) => ({
                        ...item,
                        duration: event.target.value,
                      })),
                    })
                  }
                  placeholder="Duration"
                  readOnly={readOnly}
                />
              </div>
              {getFieldError(validationIssues, `projects.${index}.name`) ? (
                <p className="mt-2 text-sm text-red-600">
                  {getFieldError(validationIssues, `projects.${index}.name`)}
                </p>
              ) : null}
              <Textarea
                value={project.description}
                onChange={(event) =>
                  onChange({
                    ...state,
                    projects: updateListItem(state.projects, index, (item) => ({
                      ...item,
                      description: event.target.value,
                    })),
                  })
                }
                className={`mt-4 ${areaClass} ${fieldClassName(
                  Boolean(getFieldError(validationIssues, `projects.${index}.description`))
                )}`}
                placeholder="Description"
                readOnly={readOnly}
              />
              {getFieldError(validationIssues, `projects.${index}.description`) ? (
                <p className="mt-2 text-sm text-red-600">
                  {getFieldError(validationIssues, `projects.${index}.description`)}
                </p>
              ) : null}
              <div className={`mt-4 grid ${compact ? "gap-2" : "gap-3"}`}>
                <SectionHeader
                  title="Technologies"
                  readOnly={readOnly}
                  compact={compact}
                  onAdd={() =>
                    onChange({
                      ...state,
                      projects: updateListItem(state.projects, index, (item) => ({
                        ...item,
                        technologies: [...(item.technologies || []), ""],
                      })),
                    })
                  }
                />
                {(project.technologies || []).map((technology, technologyIndex) => (
                  <div
                    key={`project-${index}-technology-${technologyIndex}`}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <Input
                      value={technology}
                      onChange={(event) =>
                        onChange({
                          ...state,
                          projects: updateListItem(state.projects, index, (item) => ({
                            ...item,
                            technologies: updateListItem(
                              item.technologies || [],
                              technologyIndex,
                              () => event.target.value
                            ),
                          })),
                        })
                      }
                      placeholder="Technology"
                      readOnly={readOnly}
                      className={fieldClassName(
                        Boolean(
                          getFieldError(
                            validationIssues,
                            `projects.${index}.technologies.${technologyIndex}`
                          )
                        )
                      )}
                    />
                    {!readOnly ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() =>
                          onChange({
                            ...state,
                            projects: updateListItem(state.projects, index, (item) => ({
                              ...item,
                              technologies: removeListItem(
                                item.technologies || [],
                                technologyIndex
                              ),
                            })),
                          })
                        }
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    ) : null}
                    {getFieldError(
                      validationIssues,
                      `projects.${index}.technologies.${technologyIndex}`
                    ) ? (
                      <p className="text-sm text-red-600 sm:col-span-2">
                        {getFieldError(
                          validationIssues,
                          `projects.${index}.technologies.${technologyIndex}`
                        )}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3">
        <SectionHeader
          title="Education"
          readOnly={readOnly}
          compact={compact}
          onAdd={() =>
            onChange({
              ...state,
              education: [
                ...state.education,
                { degree: "", institution: "", field: "", graduationDate: "" },
              ],
            })
          }
        />
        <div className={`grid ${cardGap}`}>
          {state.education.map((entry, index) => (
            <div
              key={`education-${index}`}
              className={`rounded-2xl border border-beige-300 bg-beige-50/70 ${cardPadding}`}
            >
              <div
                className={`${compact ? "mb-3" : "mb-4"} flex items-center justify-between gap-2`}
              >
                <div className="text-sm font-medium text-stone-700">Education #{index + 1}</div>
                {!readOnly ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({ ...state, education: removeListItem(state.education, index) })
                    }
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Remove
                  </Button>
                ) : null}
              </div>
              <div className={`grid ${compact ? "gap-3" : "gap-4"} md:grid-cols-2`}>
                <Input
                  value={entry.degree}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      education: updateListItem(state.education, index, (item) => ({
                        ...item,
                        degree: event.target.value,
                      })),
                    })
                  }
                  placeholder="Degree"
                  readOnly={readOnly}
                  className={fieldClassName(
                    Boolean(getFieldError(validationIssues, `education.${index}.degree`))
                  )}
                />
                <Input
                  value={entry.graduationDate || ""}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      education: updateListItem(state.education, index, (item) => ({
                        ...item,
                        graduationDate: event.target.value,
                      })),
                    })
                  }
                  placeholder="Graduation date"
                  readOnly={readOnly}
                />
              </div>
              {getFieldError(validationIssues, `education.${index}.degree`) ? (
                <p className="mt-2 text-sm text-red-600">
                  {getFieldError(validationIssues, `education.${index}.degree`)}
                </p>
              ) : null}
              <Input
                value={entry.institution}
                onChange={(event) =>
                  onChange({
                    ...state,
                    education: updateListItem(state.education, index, (item) => ({
                      ...item,
                      institution: event.target.value,
                    })),
                  })
                }
                placeholder="Institution"
                readOnly={readOnly}
                className={`mt-4 ${fieldClassName(
                  Boolean(getFieldError(validationIssues, `education.${index}.institution`))
                )}`}
              />
              {getFieldError(validationIssues, `education.${index}.institution`) ? (
                <p className="mt-2 text-sm text-red-600">
                  {getFieldError(validationIssues, `education.${index}.institution`)}
                </p>
              ) : null}
              <Input
                value={entry.field || ""}
                onChange={(event) =>
                  onChange({
                    ...state,
                    education: updateListItem(state.education, index, (item) => ({
                      ...item,
                      field: event.target.value,
                    })),
                  })
                }
                placeholder="Field / notes"
                readOnly={readOnly}
                className="mt-4"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ResumeLibrary({
  compact = false,
  title = "Resume Manager",
  description = "Upload and manage PDF resumes stored in your tracker.",
}: {
  compact?: boolean;
  title?: string;
  description?: string;
}) {
  const { resumes, isLoading, loadResumes, addResume, deleteResume } = useResumeStore();

  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [previewResumeId, setPreviewResumeId] = useState<string | null>(null);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadParsing, setUploadParsing] = useState(false);
  const [uploadParsed, setUploadParsed] = useState<ResumeEditorState | null>(null);
  const [uploadValidationIssues, setUploadValidationIssues] = useState<ValidationIssue[]>([]);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [previewEditorState, setPreviewEditorState] = useState<ResumeEditorState | null>(null);
  const [previewFileUrl, setPreviewFileUrl] = useState<string | null>(null);
  const [previewFileLoading, setPreviewFileLoading] = useState(false);

  const resetUploadState = () => {
    setUploadName("");
    setUploadFile(null);
    setUploadError("");
    setUploading(false);
    setUploadParsing(false);
    setUploadParsed(null);
    setUploadValidationIssues([]);
  };

  useEffect(() => {
    loadResumes();
  }, [loadResumes]);

  const previewResume = useMemo(
    () => resumes.find((resume) => resume.id === previewResumeId) || null,
    [previewResumeId, resumes]
  );
  const uploadParsedPreview = useMemo(
    () => (uploadParsed ? editorStateToParsedResume(uploadParsed) : null),
    [uploadParsed]
  );

  useEffect(() => {
    if (!previewResume) {
      setPreviewEditorState(null);
      return;
    }

    setPreviewEditorState(
      parsedResumeToEditorState(previewResume.parsedContent, previewResume.content)
    );
  }, [previewResume]);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;

    if (!previewResume) {
      setPreviewFileUrl(null);
      setPreviewFileLoading(false);
      return;
    }

    setPreviewFileLoading(true);
    setPreviewFileUrl(null);

    (async () => {
      try {
        const response = await fetchWithAuth(sfn("resume-file", { id: previewResume.id }), {
          method: "GET",
        });
        if (!response.ok) {
          throw new Error("Failed to load resume preview.");
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!active) return;
        setPreviewFileUrl(objectUrl);
      } catch {
        if (!active) return;
        setPreviewFileUrl(null);
      } finally {
        if (active) {
          setPreviewFileLoading(false);
        }
      }
    })();

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [previewResume]);

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] || null;
    setUploadError("");
    setUploadValidationIssues([]);
    setUploadFile(file);
    setUploadParsed(null);
    if (file && !uploadName.trim()) {
      setUploadName(file.name.replace(/\.pdf$/i, ""));
    }

    if (!file) return;

    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      setUploadError("Only PDF files are supported.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadError("Resume file must be 5 MB or smaller.");
      return;
    }

    setUploadParsing(true);
    try {
      const extractedText = await extractTextFromPdf(file);

      const parsedContent = parseResumeTextEnhanced(extractedText);

      setUploadParsed(parsedResumeToEditorState(parsedContent, extractedText));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to parse resume locally.");
    } finally {
      setUploadParsing(false);
    }
  };

  const handleUpload = async () => {
    if (!uploadFile) {
      setUploadError("Choose a PDF file to continue.");
      return;
    }

    if (!uploadParsed) {
      setUploadError("Please wait for parsing to finish before uploading.");
      return;
    }

    const validationIssues = validateResumeEditorState(uploadParsed);
    if (validationIssues.length > 0) {
      setUploadValidationIssues(validationIssues);
      setUploadError(
        validationIssues.length === 1
          ? validationIssues[0].message
          : `${validationIssues.length} fields need attention before upload.`
      );
      return;
    }

    setUploading(true);
    try {
      setUploadValidationIssues([]);
      const parsedContent = editorStateToParsedResume(uploadParsed);
      await addResume({
        name: uploadName.trim() || uploadFile.name.replace(/\.pdf$/i, ""),
        file: uploadFile,
        content: uploadParsed.rawText.trim(),
        parsedContent,
      });
      setIsUploadDialogOpen(false);
      resetUploadState();
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Failed to upload resume.");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (resumeId: string) => {
    setDeletingId(resumeId);
    try {
      await deleteResume(resumeId);
      if (previewResumeId === resumeId) {
        setPreviewResumeId(null);
      }
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className={compact ? "space-y-4" : "space-y-6"}>
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className={compact ? "text-lg font-semibold" : "text-2xl font-bold"}>{title}</h2>
          <p className="text-sm text-stone-500">{description}</p>
        </div>
        <Button onClick={() => setIsUploadDialogOpen(true)} size={compact ? "sm" : "default"}>
          <Plus className="mr-2 h-4 w-4" />
          Add Resume
        </Button>
      </div>

      {isLoading ? (
        <div className="text-sm text-stone-500">Loading resumes...</div>
      ) : resumes.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-center text-sm text-stone-500">
            {emptyStateMessage(compact)}
          </CardContent>
        </Card>
      ) : (
        <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2 xl:grid-cols-3"}>
          {resumes.map((resume) => (
            <Card
              key={resume.id}
              className="overflow-hidden border-beige-300 bg-gradient-to-br from-white to-beige-100/60 transition-colors"
            >
              <CardHeader className={compact ? "pb-3" : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <CardTitle className="truncate text-base">{resume.name}</CardTitle>
                    <CardDescription className="mt-1">
                      {resume.sourceFileName || "PDF resume"} • {formatBytes(resume.fileSize)}
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-4 gap-2 text-xs text-stone-600">
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.skills.length}
                    </div>
                    <div>Skills</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.experience.length}
                    </div>
                    <div>Experience</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.projects.length}
                    </div>
                    <div>Projects</div>
                  </div>
                  <div>
                    <div className="font-medium text-stone-800">
                      {resume.parsedContent.education.length}
                    </div>
                    <div>Education</div>
                  </div>
                </div>

                <div className="rounded-xl border border-beige-300 bg-white/80 p-3">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Parsed Snapshot
                  </div>
                  <p className="line-clamp-3 text-sm text-stone-700">
                    {resume.parsedContent.skills.join(", ") || "No parsed skills yet."}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPreviewResumeId(resume.id)}>
                    <Eye className="mr-2 h-4 w-4" />
                    Parsed View
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(resume.id)}
                    disabled={deletingId === resume.id}
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog
        open={isUploadDialogOpen}
        onOpenChange={(open) => {
          // Prevent closing the modal while parsing or uploading.
          if (!open && (uploading || uploadParsing)) {
            return;
          }
          setIsUploadDialogOpen(open);
          if (!open) {
            resetUploadState();
          }
        }}
      >
        <DialogContent className="h-[88vh] max-h-[88vh] max-w-6xl overflow-hidden border-beige-300 bg-beige-50 p-0">
          <div className="grid h-full min-h-0 gap-0 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="border-b border-beige-300 bg-gradient-to-b from-white to-beige-100 p-6 lg:border-b-0 lg:border-r">
              <DialogHeader>
                <DialogTitle>Upload Resume</DialogTitle>
                <DialogDescription>
                  Select a PDF, parse it automatically, review the extracted data, then upload the
                  edited result.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 space-y-4">
                <div>
                  <label className="text-sm font-medium text-stone-700">PDF File</label>
                  <Input
                    type="file"
                    accept=".pdf,application/pdf"
                    onChange={handleFileChange}
                    disabled={uploading || uploadParsing}
                  />
                </div>
                <div className="rounded-2xl border border-dashed border-beige-300 bg-white/80 p-4 text-sm text-stone-600">
                  {uploadParsing ? (
                    <div className="flex items-center gap-2 text-orange-brand">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Parsing resume and building structured sections...
                    </div>
                  ) : uploadParsed ? (
                    <div className="space-y-2">
                      <div className="font-medium text-stone-800">Ready to upload</div>
                      <div className="text-xs text-stone-500">
                        Review the parsed fields on the right before uploading.
                      </div>
                      {uploadParsedPreview ? (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>{uploadParsedPreview.skills.length} skills</div>
                          <div>{uploadParsedPreview.experience.length} roles</div>
                          <div>{uploadParsedPreview.projects.length} projects</div>
                          <div>{uploadParsedPreview.education.length} education</div>
                        </div>
                      ) : null}
                      {uploadFile ? (
                        <div className="text-xs text-stone-500">
                          PDF size: {formatBytes(uploadFile.size)}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="font-medium text-stone-800">Next step</div>
                      <div className="text-xs text-stone-500">
                        Choose a PDF to extract structured resume data, review it, and upload when
                        it looks right.
                      </div>
                    </div>
                  )}
                </div>
                {uploadError ? <p className="text-sm text-red-600">{uploadError}</p> : null}
                {uploadValidationIssues.length > 0 ? (
                  <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                    <div className="font-medium">Fix these fields before upload:</div>
                    <ul className="mt-2 space-y-1">
                      {uploadValidationIssues.map((issue) => (
                        <li key={issue.path}>• {issue.message}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {uploadFile || uploadParsed || uploadName ? (
                  <Button
                    variant="ghost"
                    onClick={resetUploadState}
                    className="w-full border border-red-300 text-red-600 hover:border-red-400 hover:bg-red-50 hover:text-red-700"
                    disabled={uploading || uploadParsing}
                  >
                    Clear
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-white">
              <div className="border-b border-beige-300 px-6 py-4">
                <div>
                  <div className="text-sm font-medium text-stone-800">Parsed Content Editor</div>
                  <div className="text-sm text-stone-500">
                    Adjust the parsed text and JSON before saving this resume.
                  </div>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                {uploadParsed ? (
                  <ParsedResumeEditor
                    state={uploadParsed}
                    onChange={(nextState) => {
                      setUploadParsed(nextState);
                      if (uploadValidationIssues.length > 0) {
                        setUploadValidationIssues(validateResumeEditorState(nextState));
                      }
                      if (uploadError) {
                        setUploadError("");
                      }
                    }}
                    validationIssues={uploadValidationIssues}
                  />
                ) : (
                  <div className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-dashed border-beige-300 bg-beige-50 text-sm text-stone-500">
                    Parsed resume content will appear here after file selection.
                  </div>
                )}
              </div>
              <DialogFooter className="border-t border-beige-300 px-6 py-4">
                <Button
                  variant="outline"
                  onClick={() => setIsUploadDialogOpen(false)}
                  disabled={uploading || uploadParsing}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpload}
                  disabled={!uploadFile || !uploadParsed || uploading || uploadParsing}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-4 w-4" />
                      Upload Resume
                    </>
                  )}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={previewResume != null}
        onOpenChange={(open) => {
          if (!open && (previewFileLoading || deletingId)) {
            return;
          }
          if (!open) {
            setPreviewResumeId(null);
          }
        }}
      >
        <DialogContent className="max-h-[88vh] max-w-7xl overflow-hidden border-beige-300 bg-beige-50 p-0">
          <div className="grid h-full gap-0 xl:grid-cols-[minmax(0,1.15fr)_520px]">
            <div className="flex min-h-0 flex-col border-b border-beige-300 bg-white xl:border-b-0 xl:border-r">
              <div className="border-b border-beige-300 px-6 py-4">
                <DialogHeader className="pr-10">
                  <DialogTitle>{previewResume?.name || "Resume Preview"}</DialogTitle>
                  <DialogDescription>
                    Review the PDF and the stored parsed content for this resume.
                  </DialogDescription>
                </DialogHeader>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden p-6">
                {previewFileLoading ? (
                  <div className="flex h-[65vh] items-center justify-center rounded-2xl border border-beige-300 bg-white text-sm text-stone-500">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Loading preview...
                  </div>
                ) : previewFileUrl ? (
                  <iframe
                    src={previewFileUrl}
                    title={`${previewResume?.name || "Resume"} preview`}
                    className="h-full min-h-[65vh] w-full rounded-2xl border border-beige-300 bg-white"
                  />
                ) : (
                  <div className="flex h-[65vh] items-center justify-center rounded-2xl border border-beige-300 bg-white text-sm text-stone-500">
                    Preview unavailable.
                  </div>
                )}
              </div>
            </div>

            <div className="flex min-h-0 flex-col bg-gradient-to-b from-beige-50 to-white">
              <div className="border-b border-beige-300 px-6 py-4">
                <div>
                  <div className="text-base font-semibold text-stone-800">
                    Stored Parsed Content
                  </div>
                  <div className="text-sm text-stone-500">
                    This is the parsed data saved with the resume record.
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-b border-beige-300 px-6 py-4 text-sm text-stone-600">
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.skills.length ?? 0}
                  </div>
                  <div>skills</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.experience.length ?? 0}
                  </div>
                  <div>experience entries</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.projects.length ?? 0}
                  </div>
                  <div>projects</div>
                </div>
                <div className="rounded-xl border border-beige-300 bg-white p-3">
                  <div className="font-medium text-stone-800">
                    {previewResume?.parsedContent.education.length ?? 0}
                  </div>
                  <div>education entries</div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 scrollbar-thin">
                {previewEditorState ? (
                  <ParsedResumeEditor
                    state={previewEditorState}
                    onChange={setPreviewEditorState}
                    readOnly
                    compact
                  />
                ) : null}
              </div>

              <div className="border-t border-beige-300 px-6 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-sm text-stone-500">
                    <FileText className="h-4 w-4" />
                    {previewResume?.sourceFileName || "PDF resume"} •{" "}
                    {formatBytes(previewResume?.fileSize)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
