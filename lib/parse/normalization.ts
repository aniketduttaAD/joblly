import type { TechStackNormalized } from "../types";
import { dedupeArray, normalizeString, capString, normalizeNumber } from "./utils";
import { extractTechFromJDText, filterFalsePositives } from "./tech-extraction";
import { getExchangeRatesToINR } from "./exchange-rates";
import { DEFAULT_EXCHANGE_RATES } from "./constants";
import { estimateSalaryOnline, convertToINRYearly } from "./salary";

export interface ParseResult {
  title: string;
  company: string;
  companyPublisher?: string | null;
  location: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: "hourly" | "monthly" | "yearly" | null;
  techStack: string[];
  techStackNormalized?: TechStackNormalized | null;
  role: string;
  experience: string;
  jobType?: string | null;
  availability?: string | null;
  product?: string | null;
  seniority?: string | null;
  collaborationTools?: string[] | null;
  source: string;
  applicantsCount?: number | null;
  education?: string | null;
  postedAt?: string | null;
  salaryEstimated?: boolean;
  _warnings?: {
    jdTruncated?: boolean;
    responseTruncated?: boolean;
  };
}

export function normalizeTechStackNormalized(raw: unknown): TechStackNormalized | null {
  if (raw == null || typeof raw !== "object") return null;

  const o = raw as Record<string, unknown>;
  const result: TechStackNormalized = {};
  const keys: (keyof TechStackNormalized)[] = [
    "languages",
    "frameworks",
    "stateManagement",
    "data",
    "apis",
    "buildTools",
    "packageManagers",
    "styling",
    "testing",
    "concepts",
    "versionControl",
    "databases",
    "architecture",
    "devOps",
    "methodologies",
    "designPrinciples",
    "operatingSystems",
    "collaborationTools",
  ];

  let hasAny = false;
  for (const key of keys) {
    const val = o[key];
    if (Array.isArray(val)) {
      const arr = dedupeArray(val);
      if (arr.length) {
        result[key] = arr;
        hasAny = true;
      }
    }
  }

  return hasAny ? result : null;
}

export async function normalizeParseResult(
  raw: ParseResult,
  jdText?: string,
  apiKey?: string | null
): Promise<ParseResult> {
  const title = capString(normalizeString(raw.title, true), 256, true) as string;
  const company = capString(normalizeString(raw.company, true), 256, true) as string;
  const location = capString(normalizeString(raw.location, true), 256, true) as string;
  const roleRaw = capString(normalizeString(raw.role, true), 256, true) as string;
  const role = roleRaw || title;
  const experienceRaw = normalizeString(raw.experience, true) as string;
  let experience = experienceRaw && experienceRaw.length <= 256 ? experienceRaw : "Not specified";

  if (jdText && experienceRaw) {
    const hasRequirements2Plus =
      /\brequirements?\b.*\b2\+?\s*years?\b/i.test(jdText) ||
      /\b2\+?\s*years?\s*(of\s+)?experience/i.test(jdText);
    const hasQualifications0To2 =
      /\bqualifications?\b.*\b0-2\s*years?\b/i.test(jdText) ||
      /\b0-2\s*years?\s*(relevant\s+)?(industry\s+)?experience/i.test(jdText);

    if (hasRequirements2Plus && hasQualifications0To2 && experience.toLowerCase().includes("2+")) {
      const qualificationsMatch = jdText.match(/qualifications?[^]*?0-2\s*years?/i);
      if (qualificationsMatch) {
        experience = "0-2 years";
        if (process.env.NODE_ENV === "development") {
          console.log(
            "[Parse] Corrected experience from Requirements (2+ years) to Qualifications (0-2 years)"
          );
        }
      }
    }
  }
  const source = capString(normalizeString(raw.source, true), 512, true) as string;

  let salaryCurrency = normalizeString(raw.salaryCurrency, true) as string;
  if (salaryCurrency && !/^[A-Z]{3}$/i.test(salaryCurrency)) {
    salaryCurrency = "";
  }

  let salaryPeriod: "hourly" | "monthly" | "yearly" = "yearly";
  if (["hourly", "monthly", "yearly"].includes(raw.salaryPeriod as string)) {
    salaryPeriod = raw.salaryPeriod as "hourly" | "monthly" | "yearly";
  }

  let salaryMin = normalizeNumber(raw.salaryMin);
  let salaryMax = normalizeNumber(raw.salaryMax);
  let salaryEstimated = raw.salaryEstimated ?? false;

  const hasSalaryFromJD = salaryMin != null || salaryMax != null;
  const needsExchangeRate =
    hasSalaryFromJD && salaryCurrency && salaryCurrency.toUpperCase() !== "INR";
  const needsSalaryEstimation =
    !hasSalaryFromJD && role && location && experience !== "Not specified";

  const [exchangeRates, estimatedSalary] = await Promise.all([
    needsExchangeRate ? getExchangeRatesToINR(apiKey) : Promise.resolve(DEFAULT_EXCHANGE_RATES),
    needsSalaryEstimation
      ? estimateSalaryOnline(role, experience, location, apiKey)
      : Promise.resolve({ min: null, max: null }),
  ]);

  if (hasSalaryFromJD && salaryCurrency) {
    const converted = convertToINRYearly(
      salaryMin,
      salaryMax,
      salaryCurrency,
      salaryPeriod,
      exchangeRates
    );
    salaryMin = converted.min;
    salaryMax = converted.max;
    salaryCurrency = "INR";
    salaryPeriod = "yearly";
    salaryEstimated = false;
  } else if (hasSalaryFromJD && !salaryCurrency) {
    if (salaryPeriod !== "yearly") {
      const converted = convertToINRYearly(
        salaryMin,
        salaryMax,
        "INR",
        salaryPeriod,
        exchangeRates
      );
      salaryMin = converted.min;
      salaryMax = converted.max;
    }
    salaryCurrency = "INR";
    salaryPeriod = "yearly";
    salaryEstimated = false;
  } else if (!hasSalaryFromJD && (estimatedSalary.min != null || estimatedSalary.max != null)) {
    salaryMin = estimatedSalary.min;
    salaryMax = estimatedSalary.max;
    salaryCurrency = "INR";
    salaryPeriod = "yearly";
    salaryEstimated = true;
  }

  if (salaryMin != null || salaryMax != null) {
    salaryCurrency = "INR";
    salaryPeriod = "yearly";
  }

  let techStack = Array.isArray(raw.techStack) ? dedupeArray(raw.techStack) : [];

  techStack = filterFalsePositives(techStack);

  const techStackNormalized = normalizeTechStackNormalized(raw.techStackNormalized);

  if (techStackNormalized) {
    const normalizedSet = new Set<string>();
    const mainSet = new Set(techStack.map((t) => t.toLowerCase()));
    const missingTechs: string[] = [];

    Object.values(techStackNormalized).forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((tech) => {
          const techLower = tech.toLowerCase();
          normalizedSet.add(techLower);
          if (!mainSet.has(techLower)) {
            missingTechs.push(tech);
          }
        });
      }
    });

    if (missingTechs.length > 0) {
      techStack = dedupeArray([...techStack, ...missingTechs]);
      if (process.env.NODE_ENV === "development") {
        console.log(
          `[Parse] Added ${missingTechs.length} missing technologies from normalized:`,
          missingTechs
        );
      }
    }
  }

  if (jdText && jdText.length > 0 && techStack.length < 80) {
    const isDebug = process.env.NODE_ENV === "development";
    if (isDebug) {
      console.log(
        `[Parse] Running fallback extraction (JD length: ${jdText.length}, current techs: ${techStack.length})`
      );
    }

    const fallbackTechs = extractTechFromJDText(jdText, techStack);
    if (fallbackTechs.length > 0) {
      techStack = dedupeArray([...techStack, ...fallbackTechs]);
      techStack = filterFalsePositives(techStack);
      if (isDebug) {
        console.log(
          `[Parse] ✅ Fallback extraction found ${fallbackTechs.length} additional technologies:`,
          fallbackTechs
        );
        console.log(`[Parse] Total technologies after fallback: ${techStack.length}`);
      }
    } else {
      if (isDebug) {
        console.log(`[Parse] Fallback extraction found no additional technologies`);
      }
    }
  }

  if (techStackNormalized && techStack.length > 0) {
    const normalizedTechSet = new Set<string>();
    const techStackSet = new Set<string>();
    const missingFromNormalized: string[] = [];

    Object.values(techStackNormalized).forEach((arr) => {
      if (Array.isArray(arr)) {
        arr.forEach((tech) => normalizedTechSet.add(tech.toLowerCase()));
      }
    });

    for (const tech of techStack) {
      const techLower = tech.toLowerCase();
      techStackSet.add(techLower);
      if (!normalizedTechSet.has(techLower)) {
        missingFromNormalized.push(tech);
      }
    }

    if (missingFromNormalized.length > 0) {
      if (!techStackNormalized.languages) techStackNormalized.languages = [];
      if (!techStackNormalized.frameworks) techStackNormalized.frameworks = [];
      if (!techStackNormalized.devOps) techStackNormalized.devOps = [];
      if (!techStackNormalized.databases) techStackNormalized.databases = [];
      if (!techStackNormalized.data) techStackNormalized.data = [];

      for (const tech of missingFromNormalized) {
        const techLower = tech.toLowerCase();

        if (
          [
            "javascript",
            "typescript",
            "python",
            "java",
            "go",
            "rust",
            "c++",
            "c#",
            "php",
            "ruby",
            "swift",
            "kotlin",
            "scala",
            "r",
            "perl",
          ].includes(techLower)
        ) {
          if (!techStackNormalized.languages.includes(tech)) {
            techStackNormalized.languages.push(tech);
          }
          continue;
        }

        if (
          techLower.includes("async") ||
          techLower === "asyncio" ||
          [
            "reactjs",
            "react",
            "next.js",
            "vue",
            "angular",
            "fastapi",
            "flask",
            "django",
            "express",
            "node.js",
          ].some((f) => techLower.includes(f))
        ) {
          if (!techStackNormalized.frameworks.includes(tech)) {
            techStackNormalized.frameworks.push(tech);
          }
          continue;
        }

        if (
          [
            "aws",
            "gcp",
            "azure",
            "ec2",
            "lambda",
            "ecs",
            "s3",
            "cloudfront",
            "rds",
            "elasticache",
            "opensearch",
            "bigquery",
            "pub/sub",
            "pubsub",
            "data factory",
            "synapse analytics",
            "synapse",
            "docker",
            "kubernetes",
            "helm",
            "operators",
            "github actions",
            "jenkins",
            "argocd",
            "prometheus",
            "grafana",
            "loki",
            "jaeger",
            "open telemetry",
            "vault",
            "aws cognito",
          ].some((s) => techLower.includes(s))
        ) {
          if (!techStackNormalized.devOps.includes(tech)) {
            techStackNormalized.devOps.push(tech);
          }
          continue;
        }

        if (
          [
            "postgresql",
            "mysql",
            "mongodb",
            "redis",
            "dynamodb",
            "snowflake",
            "cassandra",
            "elasticsearch",
            "oracle",
            "sql server",
          ].some((db) => techLower.includes(db))
        ) {
          if (!techStackNormalized.databases.includes(tech)) {
            techStackNormalized.databases.push(tech);
          }
          continue;
        }

        if (
          ["spark", "pyspark", "pandas", "numpy", "airflow", "dbt", "kafka", "rabbitmq"].some((d) =>
            techLower.includes(d)
          )
        ) {
          if (!techStackNormalized.data.includes(tech)) {
            techStackNormalized.data.push(tech);
          }
          continue;
        }
      }

      if (process.env.NODE_ENV === "development" && missingFromNormalized.length > 0) {
        console.log(
          `[Parse] Auto-categorized ${missingFromNormalized.length} missing technologies in normalization:`,
          missingFromNormalized
        );
      }
    }
  }

  const collaborationTools = Array.isArray(raw.collaborationTools)
    ? dedupeArray(raw.collaborationTools, 64)
    : null;

  return {
    title,
    company,
    companyPublisher: capString(normalizeString(raw.companyPublisher), 256),
    location,
    salaryMin,
    salaryMax,
    salaryCurrency: salaryMin != null || salaryMax != null ? salaryCurrency || "INR" : null,
    salaryPeriod: salaryMin != null || salaryMax != null ? salaryPeriod || "yearly" : null,
    techStack,
    techStackNormalized,
    role,
    experience,
    jobType: capString(normalizeString(raw.jobType), 64),
    availability: capString(normalizeString(raw.availability), 64),
    product: capString(normalizeString(raw.product), 256),
    seniority: capString(normalizeString(raw.seniority), 64),
    collaborationTools: collaborationTools?.length ? collaborationTools : null,
    source,
    applicantsCount: normalizeNumber(raw.applicantsCount),
    education: capString(normalizeString(raw.education), 2000),
    postedAt: capString(normalizeString(raw.postedAt), 128),
    salaryEstimated,
  };
}

export function validateAndFixRequired(parsed: ParseResult | Record<string, unknown>): void {
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.title !== "string") obj.title = "";
  if (typeof obj.company !== "string") obj.company = "";
  if (typeof obj.location !== "string") obj.location = "";
}
