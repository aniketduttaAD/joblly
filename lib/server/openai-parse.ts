import type { JobRecord } from "@/lib/types";
import type { AiProviderId } from "@/lib/server/ai-cookies";
import { completeChatJsonText } from "@/lib/server/ai-completion";
import { GEMINI_PARSE_MODEL, OPENAI_PARSE_MODEL } from "@/lib/server/ai-models";
const MAX_JD_CHARS = 60_000;
const OPENAI_TIMEOUT_MS = 45_000;
const MAX_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 1000;
const MAX_TOKENS_RESPONSE = 4000;
const EXCHANGE_RATE_CACHE_TTL_MS = 3_600_000;
const SALARY_ESTIMATE_TIMEOUT_MS = 10_000;

const DEFAULT_EXCHANGE_RATES: Record<string, number> = {
  USD: 83.5,
  EUR: 90.2,
  GBP: 105.3,
  CAD: 61.5,
  AUD: 54.8,
  SGD: 61.2,
  JPY: 0.56,
  CHF: 93.5,
};

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly isRetryable = false
  ) {
    super(message);
    this.name = "ParseError";
  }
}

function isRetryableError(error: Error): boolean {
  return [
    "timeout",
    "rate limit",
    "429",
    "500",
    "502",
    "503",
    "network",
    "ECONNRESET",
    "ETIMEDOUT",
  ].some((p) => error.message.includes(p));
}

function isNonRetryableError(error: Error): boolean {
  return [
    "Empty response",
    "Invalid response structure",
    "content policy",
    "authentication failed",
    "Job description text is empty",
    "must be a string",
    "Response too short",
  ].some((p) => error.message.includes(p));
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  errorMsg: string
): Promise<T> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new ParseError(errorMsg, true)), timeoutMs)
  );
  return Promise.race([promise, timeout]);
}

export function normalizeString(value: unknown, required = false): string | null {
  if (value == null) return required ? "" : null;
  const s = String(value).trim();
  if (!s || s === "null" || s === "undefined") return required ? "" : null;
  return s;
}

export function capString(s: string | null, maxLen: number, required = false): string | null {
  if (s == null) return required ? "" : null;
  if (s.length <= maxLen) return s;
  const capped = s.slice(0, maxLen).trim();
  return capped || (required ? "" : null);
}

export function dedupeArray(items: string[], maxLen = 128): string[] {
  const seen = new Set<string>();
  return items
    .map((t) => String(t).trim().slice(0, maxLen))
    .filter((s) => {
      if (!s) return false;
      const key = s.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

export function normalizeNumber(value: unknown, min = 0, max = 1_000_000_000): number | null {
  if (value == null) return null;
  const num = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(num) || num < min || num > max) return null;
  return Math.round(num);
}

function extractJSON(raw: string): string {
  let content = raw.trim();
  if (content.startsWith("```")) {
    const lines = content.split("\n");
    const startIdx = lines[0].toLowerCase().includes("json") ? 1 : 0;
    const endIdx = lines[lines.length - 1].trim() === "```" ? lines.length - 1 : lines.length;
    content = lines.slice(startIdx, endIdx).join("\n").trim();
  }
  if (!content.startsWith("{")) {
    const s = content.indexOf("{"),
      e = content.lastIndexOf("}");
    if (s !== -1 && e !== -1 && e > s) content = content.substring(s, e + 1);
  }
  return content;
}

async function retryWithBackoff<T>(fn: () => Promise<T>, maxRetries = MAX_RETRIES): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) await sleep(BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isNonRetryableError(lastError)) throw lastError;
      if (!isRetryableError(lastError) || attempt === maxRetries) throw lastError;
    }
  }
  throw lastError || new Error("Parse failed after retries");
}

const FALSE_POSITIVES = new Set([
  "on-site",
  "onsite",
  "remote",
  "hybrid",
  "full-time",
  "fulltime",
  "part-time",
  "parttime",
  "contract",
  "gdpr",
  "hipaa",
  "soc2",
  "soc 2",
  "pci",
  "pci dss",
  "iso 27001",
  "healthcare",
  "pharmaceutical consulting",
  "management consulting",
  "hospital systems",
  "payers",
  "enterprise level data-analytical solutions",
  "enterprise level",
  "data-analytical solutions",
  "apache",
  "github",
  "kafka",
]);

export function filterFalsePositives(techStack: string[]): string[] {
  const techSet = new Set(techStack.map((t) => t.toLowerCase()));
  return techStack.filter((tech) => {
    const tl = tech.toLowerCase();
    if (FALSE_POSITIVES.has(tl)) return false;
    if (
      tl === "apache" &&
      Array.from(techSet).some((t) => t.startsWith("apache ") && t !== "apache")
    )
      return false;
    if (tl === "github" && techSet.has("github actions")) return false;
    if (tl === "kafka" && techSet.has("apache kafka")) return false;
    if (tech.length > 40 || tech.split(" ").length > 5) {
      const allowed = [
        "azure synapse analytics",
        "azure data factory",
        "google cloud platform",
        "amazon web services",
      ];
      if (!allowed.some((a) => tl.includes(a))) return false;
    }
    return true;
  });
}

const TECH_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bjavascript\b/i, name: "JavaScript" },
  { pattern: /\btypescript\b/i, name: "TypeScript" },
  { pattern: /\bpython\b/i, name: "Python" },
  { pattern: /\bjava\b/i, name: "Java" },
  { pattern: /\bgolang\b/i, name: "Go" },
  { pattern: /\brust\b/i, name: "Rust" },
  { pattern: /\bc\+\+\b/i, name: "C++" },
  { pattern: /\bcpp\b/i, name: "C++" },
  { pattern: /\bc#\b/i, name: "C#" },
  { pattern: /\bphp\b/i, name: "PHP" },
  { pattern: /\bruby\b/i, name: "Ruby" },
  { pattern: /\bswift\b/i, name: "Swift" },
  { pattern: /\bkotlin\b/i, name: "Kotlin" },
  { pattern: /\bscala\b/i, name: "Scala" },
  { pattern: /\baws\b/i, name: "AWS" },
  { pattern: /\brds\b/i, name: "RDS" },
  { pattern: /\belasticache\b/i, name: "ElastiCache" },
  { pattern: /\bopensearch\b/i, name: "OpenSearch" },
  { pattern: /\bec2\b/i, name: "EC2" },
  { pattern: /\blambda\b/i, name: "Lambda" },
  { pattern: /\becs\b/i, name: "ECS" },
  { pattern: /\bs3\b/i, name: "S3" },
  { pattern: /\bcloudfront\b/i, name: "CloudFront" },
  { pattern: /\bcognito\b/i, name: "AWS Cognito" },
  { pattern: /\biam\b/i, name: "IAM" },
  { pattern: /\bvpc\b/i, name: "VPC" },
  { pattern: /\broute53\b/i, name: "Route53" },
  { pattern: /\bcloudwatch\b/i, name: "CloudWatch" },
  { pattern: /\bcloudformation\b/i, name: "CloudFormation" },
  { pattern: /\bterraform\b/i, name: "Terraform" },
  { pattern: /\bsns\b/i, name: "SNS" },
  { pattern: /\bsqs\b/i, name: "SQS" },
  { pattern: /\bapi gateway\b/i, name: "API Gateway" },
  { pattern: /\bgcp\b/i, name: "GCP" },
  { pattern: /\bgoogle cloud\b/i, name: "GCP" },
  { pattern: /\bbigquery\b/i, name: "BigQuery" },
  { pattern: /\bpub\/sub\b/i, name: "Pub/Sub" },
  { pattern: /\bcloud functions\b/i, name: "Cloud Functions" },
  { pattern: /\bcloud run\b/i, name: "Cloud Run" },
  { pattern: /\bazure\b/i, name: "Azure" },
  { pattern: /\bdata factory\b/i, name: "Data Factory" },
  { pattern: /\bsynapse analytics\b/i, name: "Synapse Analytics" },
  { pattern: /\bsynapse\b/i, name: "Synapse Analytics" },
  { pattern: /\bazure functions\b/i, name: "Azure Functions" },
  { pattern: /\baks\b/i, name: "Azure Kubernetes Service" },
  { pattern: /\breactjs\b/i, name: "ReactJS" },
  { pattern: /\breact\b/i, name: "ReactJS" },
  { pattern: /\bnext\.js\b/i, name: "Next.js" },
  { pattern: /\bnextjs\b/i, name: "Next.js" },
  { pattern: /\bfastapi\b/i, name: "FastAPI" },
  { pattern: /\bflask\b/i, name: "Flask" },
  { pattern: /\bdjango\b/i, name: "Django" },
  { pattern: /\bnode\.js\b/i, name: "Node.js" },
  { pattern: /\bnodejs\b/i, name: "Node.js" },
  { pattern: /\bexpress\b/i, name: "Express" },
  { pattern: /\bvue\b/i, name: "Vue.js" },
  { pattern: /\bvue\.js\b/i, name: "Vue.js" },
  { pattern: /\bangular\b/i, name: "Angular" },
  { pattern: /\bsvelte\b/i, name: "Svelte" },
  { pattern: /\bspring boot\b/i, name: "Spring Boot" },
  { pattern: /\bspring\b/i, name: "Spring" },
  { pattern: /\blaravel\b/i, name: "Laravel" },
  { pattern: /\bruby on rails\b/i, name: "Ruby on Rails" },
  { pattern: /\brails\b/i, name: "Ruby on Rails" },
  { pattern: /\basp\.net\b/i, name: "ASP.NET" },
  { pattern: /\b\.net\b/i, name: ".NET" },
  { pattern: /\bpostgresql\b/i, name: "PostgreSQL" },
  { pattern: /\bpostgres\b/i, name: "PostgreSQL" },
  { pattern: /\bmysql\b/i, name: "MySQL" },
  { pattern: /\bsnowflake\b/i, name: "Snowflake" },
  { pattern: /\bmongodb\b/i, name: "MongoDB" },
  { pattern: /\bdynamodb\b/i, name: "DynamoDB" },
  { pattern: /\bredis\b/i, name: "Redis" },
  { pattern: /\bcassandra\b/i, name: "Cassandra" },
  { pattern: /\belasticsearch\b/i, name: "Elasticsearch" },
  { pattern: /\bsqlite\b/i, name: "SQLite" },
  { pattern: /\boracle\b/i, name: "Oracle" },
  { pattern: /\bsql server\b/i, name: "SQL Server" },
  { pattern: /\bmariadb\b/i, name: "MariaDB" },
  { pattern: /\bpyspark\b/i, name: "PySpark" },
  { pattern: /\bpandas\b/i, name: "Pandas" },
  { pattern: /\bnumpy\b/i, name: "NumPy" },
  { pattern: /\bapache spark\b/i, name: "Spark" },
  { pattern: /\bairflow\b/i, name: "Airflow" },
  { pattern: /\bdbt\b/i, name: "dbt" },
  { pattern: /\bjupyter\b/i, name: "Jupyter" },
  { pattern: /\bdatabricks\b/i, name: "Databricks" },
  { pattern: /\bhadoop\b/i, name: "Hadoop" },
  { pattern: /\bapache kafka\b/i, name: "Apache Kafka" },
  { pattern: /\bkafka\b/i, name: "Apache Kafka" },
  { pattern: /\brabbitmq\b/i, name: "RabbitMQ" },
  { pattern: /\bscikit-learn\b/i, name: "Scikit-learn" },
  { pattern: /\bsklearn\b/i, name: "Scikit-learn" },
  { pattern: /\btensorflow\b/i, name: "TensorFlow" },
  { pattern: /\bpytorch\b/i, name: "PyTorch" },
  { pattern: /\bkeras\b/i, name: "Keras" },
  { pattern: /\bxgboost\b/i, name: "XGBoost" },
  { pattern: /\bdocker\b/i, name: "Docker" },
  { pattern: /\bkubernetes\b/i, name: "Kubernetes" },
  { pattern: /\bk8s\b/i, name: "Kubernetes" },
  { pattern: /\bhelm\b/i, name: "Helm" },
  { pattern: /\bgithub actions\b/i, name: "GitHub Actions" },
  { pattern: /\bjenkins\b/i, name: "Jenkins" },
  { pattern: /\bargocd\b/i, name: "ArgoCD" },
  { pattern: /\bgitlab ci\b/i, name: "GitLab CI" },
  { pattern: /\bgitlab\b/i, name: "GitLab" },
  { pattern: /\bcircleci\b/i, name: "CircleCI" },
  { pattern: /\bgit\b/i, name: "Git" },
  { pattern: /\bbitbucket\b/i, name: "Bitbucket" },
  { pattern: /\bprometheus\b/i, name: "Prometheus" },
  { pattern: /\bgrafana\b/i, name: "Grafana" },
  { pattern: /\brest\b/i, name: "REST" },
  { pattern: /\bgraphql\b/i, name: "GraphQL" },
  { pattern: /\bvault\b/i, name: "Vault" },
  { pattern: /\bokta\b/i, name: "Okta" },
  { pattern: /\bauth0\b/i, name: "Auth0" },
  { pattern: /\boauth\b/i, name: "OAuth" },
  { pattern: /\bjwt\b/i, name: "JWT" },
  { pattern: /\bjest\b/i, name: "Jest" },
  { pattern: /\bcypress\b/i, name: "Cypress" },
  { pattern: /\bplaywright\b/i, name: "Playwright" },
  { pattern: /\bselenium\b/i, name: "Selenium" },
  { pattern: /\bredux\b/i, name: "Redux" },
  { pattern: /\bzustand\b/i, name: "Zustand" },
  { pattern: /\bwebpack\b/i, name: "Webpack" },
  { pattern: /\bvite\b/i, name: "Vite" },
  { pattern: /\bnpm\b/i, name: "npm" },
  { pattern: /\byarn\b/i, name: "Yarn" },
  { pattern: /\bpnpm\b/i, name: "pnpm" },
  { pattern: /\bcss\b/i, name: "CSS" },
  { pattern: /\bsass\b/i, name: "SASS" },
  { pattern: /\bscss\b/i, name: "SCSS" },
  { pattern: /\btailwind css\b/i, name: "Tailwind CSS" },
  { pattern: /\btailwind\b/i, name: "Tailwind CSS" },
  { pattern: /\bbootstrap\b/i, name: "Bootstrap" },
  { pattern: /\bmaterial-ui\b/i, name: "Material-UI" },
  { pattern: /\bmui\b/i, name: "Material-UI" },
  { pattern: /\btableau\b/i, name: "Tableau" },
  { pattern: /\bpower bi\b/i, name: "Power BI" },
  { pattern: /\bsql\b/i, name: "SQL" },
  { pattern: /\blooker\b/i, name: "Looker" },
  { pattern: /\bdatadog\b/i, name: "Datadog" },
  { pattern: /\bnew relic\b/i, name: "New Relic" },
  { pattern: /\bsplunk\b/i, name: "Splunk" },
  { pattern: /\belk stack\b/i, name: "ELK Stack" },
  { pattern: /\bkibana\b/i, name: "Kibana" },
  { pattern: /\bansible\b/i, name: "Ansible" },
  { pattern: /\bnginx\b/i, name: "Nginx" },
  { pattern: /\bistio\b/i, name: "Istio" },
  { pattern: /\breact native\b/i, name: "React Native" },
  { pattern: /\bflutter\b/i, name: "Flutter" },
  { pattern: /\bandroid\b/i, name: "Android" },
  { pattern: /\bios\b/i, name: "iOS" },
  { pattern: /\bfigma\b/i, name: "Figma" },
  { pattern: /\bjira\b/i, name: "Jira" },
  { pattern: /\bconfluence\b/i, name: "Confluence" },
  { pattern: /\bnotion\b/i, name: "Notion" },
  { pattern: /\bslack\b/i, name: "Slack" },
  { pattern: /\bpagerduty\b/i, name: "PagerDuty" },
  { pattern: /\bopsgenie\b/i, name: "Opsgenie" },
  { pattern: /\bprefect\b/i, name: "Prefect" },
  { pattern: /\bdagster\b/i, name: "Dagster" },
  { pattern: /\basyncio\b/i, name: "AsyncIO" },
];

const SERVICE_MAP: Record<string, string> = {
  rds: "RDS",
  elasticache: "ElastiCache",
  opensearch: "OpenSearch",
  ec2: "EC2",
  lambda: "Lambda",
  ecs: "ECS",
  s3: "S3",
  cloudfront: "CloudFront",
  bigquery: "BigQuery",
  "pub/sub": "Pub/Sub",
  pubsub: "Pub/Sub",
  "data factory": "Data Factory",
  "synapse analytics": "Synapse Analytics",
  synapse: "Synapse Analytics",
  asyncio: "AsyncIO",
};

export function extractTechFromJDText(jdText: string, existingTechStack: string[]): string[] {
  const existingSet = new Set(existingTechStack.map((t) => t.toLowerCase()));
  const found: string[] = [];
  for (const { pattern, name } of TECH_PATTERNS) {
    if (pattern.test(jdText) && !existingSet.has(name.toLowerCase())) {
      found.push(name);
      existingSet.add(name.toLowerCase());
    }
  }
  const parenPattern = /(AWS|GCP|Azure)\s*\(([^)]+)\)/gi;
  let match;
  parenPattern.lastIndex = 0;
  while ((match = parenPattern.exec(jdText)) !== null) {
    const services = match[2]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const svc of services) {
      const svcLower = svc.toLowerCase();
      const mapped = SERVICE_MAP[svcLower] || svc;
      if (!existingSet.has(mapped.toLowerCase())) {
        found.push(mapped);
        existingSet.add(mapped.toLowerCase());
      }
    }
  }
  return dedupeArray(found);
}

let cachedPrompt: string | null = null;
let cachedPromptDate: string | null = null;

function getSystemPrompt(): string {
  const todayStr = new Date().toISOString().split("T")[0];
  if (cachedPrompt && cachedPromptDate === todayStr) return cachedPrompt;
  const prompt = `Extract structured data from job description. Return valid JSON only—no markdown.

Search ALL sections for salary/compensation. Extract salary exactly as written; leave null if not found.
Date parsing: use YYYY-MM-DD. For relative dates ("2 days ago"), calculate from today: ${todayStr}.

Tech stack extraction — BE COMPREHENSIVE. Extract every technology, tool, service, framework, library.
Extract from ALL sections, including parentheses and compound mentions like "Python/TypeScript".

Return JSON with these fields:
- title: string
- company: string
- companyPublisher: string|null (job board/aggregator name if not direct employer)
- location: string
- salaryMin: number|null
- salaryMax: number|null
- salaryCurrency: string|null (3-letter ISO code, e.g. "INR", "USD")
- salaryPeriod: "hourly"|"monthly"|"yearly"|null
- salaryEstimated: false (always false — estimation done programmatically)
- techStack: string[] (comprehensive list of ALL technologies mentioned)
- techStackNormalized: object|null with keys: languages, frameworks, stateManagement, data, apis, buildTools, packageManagers, styling, testing, concepts, versionControl, databases, architecture, devOps, methodologies, designPrinciples, operatingSystems, collaborationTools
- role: string (normalized role type)
- experience: string (e.g. "2+ years", "0-2 years", "3-5 years")
- jobType: "full-time"|"part-time"|"contract"|"internship"|null
- availability: string|null
- product: string|null (product/domain focus)
- seniority: "junior"|"mid"|"senior"|"lead"|"principal"|"staff"|null
- collaborationTools: string[]|null
- source: string (job board or company name where posted)
- applicantsCount: number|null
- education: string|null (education requirements)
- postedAt: string|null (YYYY-MM-DD)`;
  cachedPrompt = prompt;
  cachedPromptDate = todayStr;
  return prompt;
}

let exchangeRateCache: { rates: Record<string, number>; timestamp: number } | null = null;

async function getExchangeRatesToINR(): Promise<Record<string, number>> {
  const now = Date.now();
  if (exchangeRateCache && now - exchangeRateCache.timestamp < EXCHANGE_RATE_CACHE_TTL_MS) {
    return exchangeRateCache.rates;
  }
  const key = process.env.OPENAI_API_KEY || "";
  try {
    const response = await withTimeout(
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `Return ONLY valid JSON with current exchange rates to INR. Format: {"USD": 83.5, "EUR": 90.2, ...}`,
            },
            {
              role: "user",
              content: `Current exchange rates to INR as of ${new Date().toISOString().split("T")[0]}?`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
          max_tokens: 200,
        }),
      }).then((r) => r.json()),
      5000,
      "Exchange rate timeout"
    );
    const content = response.choices?.[0]?.message?.content;
    if (content) {
      const rates = JSON.parse(content) as Record<string, number>;
      const validated: Record<string, number> = {};
      for (const [cur, rate] of Object.entries(rates)) {
        const n = typeof rate === "number" ? rate : parseFloat(String(rate));
        if (Number.isFinite(n) && n > 0 && n < 10000) validated[cur.toUpperCase()] = n;
      }
      if (Object.keys(validated).length > 0) {
        exchangeRateCache = { rates: validated, timestamp: now };
        return validated;
      }
    }
  } catch {
    /* fall through */
  }
  return DEFAULT_EXCHANGE_RATES;
}

async function estimateSalaryOnline(
  role: string,
  experience: string,
  location: string
): Promise<{ min: number | null; max: number | null }> {
  const key = process.env.OPENAI_API_KEY || "";
  try {
    const response = await withTimeout(
      fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `You are a salary research assistant. Return ONLY valid JSON with salary range in INR (yearly). Format: {"min": number, "max": number}. Return {"min": null, "max": null} if no reliable data.`,
            },
            {
              role: "user",
              content: `Typical salary range (INR yearly) for a ${role} position requiring ${experience} of experience in ${location}?`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.3,
          max_tokens: 150,
        }),
      }).then((r) => r.json()),
      SALARY_ESTIMATE_TIMEOUT_MS,
      "Salary estimate timeout"
    );
    const content = response.choices?.[0]?.message?.content;
    if (!content) return { min: null, max: null };
    const result = JSON.parse(content) as { min?: number | null; max?: number | null };
    const min = normalizeNumber(result.min);
    const max = normalizeNumber(result.max);
    if (min != null && max != null && max < min) return { min: max, max: min };
    return { min, max };
  } catch {
    return { min: null, max: null };
  }
}

function convertToINRYearly(
  salaryMin: number | null,
  salaryMax: number | null,
  currency: string,
  period: "hourly" | "monthly" | "yearly",
  exchangeRates: Record<string, number>
): { min: number | null; max: number | null } {
  if (salaryMin == null && salaryMax == null) return { min: null, max: null };
  let min = salaryMin,
    max = salaryMax;
  if (currency && currency.toUpperCase() !== "INR") {
    const rate = exchangeRates[currency.toUpperCase()];
    if (rate && Number.isFinite(rate) && rate > 0) {
      if (min != null) min = Math.round(min * rate);
      if (max != null) max = Math.round(max * rate);
    }
  }
  const multiplier = period === "hourly" ? 2080 : period === "monthly" ? 12 : 1;
  if (min != null) {
    const c = min * multiplier;
    min = Number.isFinite(c) && c <= 1_000_000_000 ? Math.round(c) : null;
  }
  if (max != null) {
    const c = max * multiplier;
    max = Number.isFinite(c) && c <= 1_000_000_000 ? Math.round(c) : null;
  }
  if (min != null && max != null && max < min) [min, max] = [max, min];
  return { min, max };
}

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
  techStackNormalized?: Record<string, unknown> | null;
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
  _warnings?: { jdTruncated?: boolean; responseTruncated?: boolean };
}

async function normalizeParseResult(
  raw: ParseResult,
  jdText?: string,
  provider: AiProviderId = "openai"
): Promise<ParseResult> {
  const title = capString(normalizeString(raw.title, true), 256, true) as string;
  const company = capString(normalizeString(raw.company, true), 256, true) as string;
  const location = capString(normalizeString(raw.location, true), 256, true) as string;
  const roleRaw = capString(normalizeString(raw.role, true), 256, true) as string;
  const role = roleRaw || title;
  const experienceRaw = normalizeString(raw.experience, true) as string;
  const experience = experienceRaw && experienceRaw.length <= 256 ? experienceRaw : "Not specified";
  const source = capString(normalizeString(raw.source, true), 512, true) as string;

  let salaryCurrency = normalizeString(raw.salaryCurrency, true) as string;
  if (salaryCurrency && !/^[A-Z]{3}$/i.test(salaryCurrency)) salaryCurrency = "";

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

  const skipOnlineEnrichment = provider === "gemini";
  const [exchangeRates, estimatedSalary] = await Promise.all([
    needsExchangeRate && !skipOnlineEnrichment
      ? getExchangeRatesToINR()
      : Promise.resolve(DEFAULT_EXCHANGE_RATES),
    needsSalaryEstimation && !skipOnlineEnrichment
      ? estimateSalaryOnline(role, experience, location)
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
  if (jdText && jdText.length > 0 && techStack.length < 80) {
    const fallback = extractTechFromJDText(jdText, techStack);
    if (fallback.length > 0)
      techStack = filterFalsePositives(dedupeArray([...techStack, ...fallback]));
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
    techStackNormalized: raw.techStackNormalized ?? null,
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

async function callParseLlm(
  content: string,
  jdWasTruncated: boolean,
  provider: AiProviderId,
  apiKey: string
): Promise<ParseResult> {
  const model = provider === "openai" ? OPENAI_PARSE_MODEL : GEMINI_PARSE_MODEL;
  let rawContent: string;
  try {
    rawContent = await withTimeout(
      completeChatJsonText(provider, apiKey, {
        model,
        messages: [
          { role: "system", content: getSystemPrompt() },
          { role: "user", content },
        ],
        temperature: 0.15,
        maxTokens: MAX_TOKENS_RESPONSE,
      }),
      OPENAI_TIMEOUT_MS,
      "Request timeout - parsing took too long"
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/content filter|blocked|SAFETY|PROHIBITED/i.test(msg)) {
      throw new ParseError("Response filtered by content policy");
    }
    throw new ParseError(msg || "Failed to parse job description", true);
  }

  if (!rawContent || rawContent.length < 10) {
    throw new ParseError("Empty response from language model");
  }

  const responseTruncated = false;

  try {
    const parsed = JSON.parse(rawContent) as ParseResult;
    if (jdWasTruncated || responseTruncated)
      parsed._warnings = { jdTruncated: jdWasTruncated, responseTruncated };
    return parsed;
  } catch {
    const fixed = extractJSON(rawContent);
    try {
      const parsed = JSON.parse(fixed) as ParseResult;
      if (jdWasTruncated || responseTruncated)
        parsed._warnings = { jdTruncated: jdWasTruncated, responseTruncated };
      return parsed;
    } catch {
      throw new ParseError("Invalid JSON in parse response", true);
    }
  }
}

export async function parseJobDescription(
  jdText: string,
  ctx: { provider: AiProviderId; apiKey: string }
): Promise<ParseResult> {
  const key = ctx.apiKey?.trim();
  if (!key) throw new ParseError("API key is not configured for job parsing.");
  if (typeof jdText !== "string") throw new ParseError("Job description must be a string");
  const text = jdText.trim();
  if (!text) throw new ParseError("Job description text is empty");

  const jdWasTruncated = text.length > MAX_JD_CHARS;
  const content = jdWasTruncated ? text.slice(0, MAX_JD_CHARS) : text;

  const parsed = await retryWithBackoff(() =>
    callParseLlm(content, jdWasTruncated, ctx.provider, ctx.apiKey)
  );
  if (typeof parsed.title !== "string") parsed.title = "";
  if (typeof parsed.company !== "string") parsed.company = "";
  if (typeof parsed.location !== "string") parsed.location = "";

  const normalized = await normalizeParseResult(parsed, text, ctx.provider);
  if (parsed._warnings) normalized._warnings = parsed._warnings;
  return normalized;
}

export function parseResultToJobRecord(
  result: ParseResult,
  jdRaw?: string
): Omit<JobRecord, "id" | "createdAt" | "updatedAt"> {
  const now = new Date().toISOString();
  return {
    title: result.title,
    company: result.company,
    companyPublisher: result.companyPublisher ?? undefined,
    location: result.location,
    salaryMin: result.salaryMin,
    salaryMax: result.salaryMax,
    salaryCurrency: result.salaryCurrency,
    salaryPeriod: result.salaryPeriod ?? "yearly",
    salaryEstimated: result.salaryEstimated ?? false,
    techStack: result.techStack,
    techStackNormalized:
      (result.techStackNormalized as JobRecord["techStackNormalized"]) ?? undefined,
    role: result.role,
    experience: result.experience,
    jobType: result.jobType ?? undefined,
    availability: result.availability ?? undefined,
    product: result.product ?? undefined,
    seniority: result.seniority ?? undefined,
    collaborationTools: result.collaborationTools ?? undefined,
    status: "applied",
    appliedAt: now,
    postedAt: result.postedAt ?? undefined,
    applicantsCount: result.applicantsCount ?? undefined,
    education: result.education ?? undefined,
    source: result.source || undefined,
    jdRaw: jdRaw ?? undefined,
  };
}
