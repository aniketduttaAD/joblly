let cachedSystemPrompt: string | null = null;
let cachedSystemPromptDate: string | null = null;

export function getSystemPrompt(): string {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  if (cachedSystemPrompt && cachedSystemPromptDate === todayStr) {
    return cachedSystemPrompt;
  }

  const sixHoursAgo = new Date(today);
  sixHoursAgo.setHours(sixHoursAgo.getHours() - 6);
  const sixHoursAgoStr = sixHoursAgo.toISOString().split("T")[0];

  const twoDaysAgo = new Date(today);
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
  const twoDaysAgoStr = twoDaysAgo.toISOString().split("T")[0];

  const prompt = `Extract structured data from job description. Return valid JSON only—no markdown.

Search ALL sections for salary/compensation: header, benefits, requirements. Look for: LPA, lakhs, per annum/year/month, hourly rate, salary ranges, competitive salary.

Salary handling:
- Found in JD: Extract exactly as written, set salaryEstimated: false
- Not found: Leave salaryMin and salaryMax as null, set salaryEstimated: false (will be estimated programmatically)
- Extract in original currency/period - conversion to INR yearly handled programmatically
- Do NOT estimate salary in this step - only extract if explicitly mentioned in JD

Date parsing:
- For relative dates like "Reposted 6 hours ago", "Posted 2 days ago", "3 weeks ago", "1 month ago", calculate actual date: today minus the time period
- For absolute dates, use YYYY-MM-DD format
- If only "Reposted" without time, use today's date
- Extract dates from header/metadata sections (e.g., "Reposted 6 hours ago", "Posted on Jan 15, 2024")
- Current date context: ${todayStr}
- Examples: "6 hours ago" → ${sixHoursAgoStr}, "2 days ago" → ${twoDaysAgoStr}

Tech stack extraction - BE COMPREHENSIVE AND EXHAUSTIVE:
CRITICAL: Extract EVERY technology, tool, service, framework, library, and skill mentioned in the JD, regardless of context, section, or phrasing.

ROLE-SPECIFIC FOCUS: Pay special attention to technologies relevant to these common roles (AI/ML Engineer, Full Stack Developer, Software Engineer, SWE, SDE, Backend Engineer, DevOps, SRE, Frontend Developer, Data Analyst, Business Analyst):

- AI/ML Engineer: ML frameworks (TensorFlow, PyTorch, Scikit-learn), data tools (Pandas, NumPy, PySpark), MLOps (MLflow, Kubeflow, Weights & Biases), cloud ML services (AWS SageMaker, GCP AI Platform, Azure ML), Jupyter, Databricks
- Full Stack Developer: Frontend (React, Vue, Angular, Next.js) AND Backend (Node.js, Express, Python, FastAPI, Flask, Django, Java, Spring Boot) frameworks, databases (PostgreSQL, MongoDB), APIs (REST, GraphQL), testing tools
- Software Engineer / SWE / SDE: Programming languages (Python, JavaScript, TypeScript, Java, Go, C++), frameworks, databases, testing tools (Jest, pytest, JUnit), version control (Git), CI/CD
- Backend Engineer: Server-side frameworks (Express, FastAPI, Flask, Django, Spring Boot, .NET), databases (PostgreSQL, MySQL, MongoDB, Redis), APIs (REST, GraphQL, gRPC), microservices, cloud services (AWS, GCP, Azure), message queues (Kafka, RabbitMQ)
- DevOps Engineer: CI/CD tools (Jenkins, GitHub Actions, GitLab CI, CircleCI), containerization (Docker, Kubernetes), cloud platforms (AWS, GCP, Azure), infrastructure as code (Terraform, CloudFormation, Ansible), monitoring (Prometheus, Grafana, Datadog)
- SRE (Site Reliability Engineer): Monitoring tools (Prometheus, Grafana, Datadog, New Relic, Splunk), observability (Open Telemetry, Jaeger, Loki), infrastructure (Kubernetes, Terraform), automation, cloud platforms, incident management (PagerDuty, Opsgenie)
- Frontend Developer: UI frameworks (React, Vue, Angular, Svelte), CSS frameworks (Tailwind CSS, Bootstrap, Material-UI), build tools (Webpack, Vite), state management (Redux, MobX, Zustand), testing tools (Jest, Cypress, Playwright)
- Data Analyst: Data tools (SQL, Python, R, Pandas), visualization tools (Tableau, Power BI, Looker, Metabase), databases (PostgreSQL, MySQL, Snowflake, BigQuery), Excel, statistical tools (SAS, SPSS, Stata, MATLAB)
- Business Analyst: Analysis tools (Excel, SQL), visualization tools (Tableau, Power BI, Qlik), BI tools (Looker, Metabase, Superset), data tools, reporting tools

Extract technologies relevant to the role type mentioned in the JD. If role mentions "Full Stack", extract BOTH frontend AND backend technologies.

Extraction rules (apply to ALL job descriptions):
1. Extract technologies mentioned in parentheses: "AWS (EC2, Lambda, RDS)" → Extract: ["AWS", "EC2", "Lambda", "RDS"]
2. Extract from "familiarity with", "experience with", "knowledge of", "proficiency in" contexts: All these phrases indicate technologies that should be extracted
3. Extract both parts of compound mentions: "JavaScript/TypeScript", "Python/Java", "React/Vue" → Extract ALL parts separately
4. Extract platform names AND their services: Extract both "AWS" and individual services like "EC2", "Lambda", etc.
5. Extract from ALL sections: Requirements, Qualifications, Responsibilities, Preferred Qualifications, Nice-to-have, Skills, Tech Stack, etc.
6. Extract variations and aliases: "Node.js" and "NodeJS" are the same, extract as "Node.js". "PostgreSQL" and "Postgres" are the same, extract as "PostgreSQL"
7. Extract version numbers if mentioned: "React 18", "Python 3.9" → Extract as "React" and "Python" (version info is optional)
8. Extract from bullet points, lists, and paragraphs: Don't skip technologies in any format
9. Extract abbreviations: "REST API" → Extract "REST", "API" → Extract "REST"
10. Extract both full names and common abbreviations: "Amazon Web Services" → Extract "AWS", "JavaScript" → Extract "JavaScript"

Categories of technologies to extract (this is NOT exhaustive - extract ANY technology mentioned):
- Cloud platforms: AWS, GCP, Azure, IBM Cloud, Oracle Cloud, Alibaba Cloud, etc. (extract platform AND all services)
- Cloud services: All services from any cloud provider (EC2, Lambda, S3, BigQuery, Azure Functions, etc.)
- Programming languages: Python, JavaScript, TypeScript, Java, Go, Rust, C++, C#, PHP, Ruby, Swift, Kotlin, Scala, R, Perl, etc.
- Web frameworks: React, Vue, Angular, Next.js, Nuxt.js, Svelte, Ember, etc.
- Backend frameworks: Express, FastAPI, Flask, Django, Spring Boot, Laravel, Rails, ASP.NET, etc.
- Databases: PostgreSQL, MySQL, MongoDB, Redis, Cassandra, Elasticsearch, Oracle, SQL Server, etc.
- Data tools: Spark, Hadoop, Airflow, dbt, Pandas, NumPy, PySpark, Jupyter, Databricks, etc.
- Streaming: Kafka, RabbitMQ, Kinesis, Pub/Sub, etc.
- ML/AI: TensorFlow, PyTorch, Scikit-learn, Keras, XGBoost, OpenCV, NLTK, spaCy, etc.
- MLOps: MLflow, Kubeflow, Weights & Biases, etc.
- Containerization: Docker, Kubernetes, Podman, Containerd, etc.
- Orchestration: Kubernetes, Docker Swarm, Nomad, etc.
- CI/CD: GitHub Actions, Jenkins, GitLab CI, CircleCI, Travis CI, Azure DevOps, etc.
- Monitoring: Prometheus, Grafana, Datadog, New Relic, Splunk, ELK Stack, etc.
- APIs: REST, GraphQL, gRPC, WebSocket, etc.
- Security: Vault, Okta, Auth0, OAuth, JWT, SAML, etc.
- Testing: Jest, Mocha, Cypress, Playwright, Selenium, pytest, JUnit, etc.
- Build tools: Webpack, Vite, Rollup, Parcel, esbuild, Babel, etc.
- Package managers: npm, yarn, pnpm, pip, conda, Maven, Gradle, etc.
- Collaboration: Slack, Jira, Confluence, Notion, Figma, etc.
- Styling: CSS, SASS, Tailwind CSS, Bootstrap, Material-UI, etc.
- Version control: Git, GitHub, GitLab, Bitbucket, SVN, etc.
- Operating systems: Linux, Windows, macOS, Unix, etc.
- Architecture patterns: Microservices, Serverless, Monolith, Event-driven, etc.
- Methodologies: Agile, Scrum, Kanban, DevOps, etc.

IMPORTANT: This list is NOT exhaustive. Extract ANY technology, tool, or skill mentioned, even if not listed above.

IMPORTANT: Put ALL extracted technologies in the techStack array. Do not skip any technology, even if it's mentioned as "familiarity with" or in parentheses.

EXAMPLES (apply these patterns to ALL job descriptions):
- "Strong proficiency in Python, JavaScript/TypeScript" → Extract: ["Python", "JavaScript", "TypeScript"]
- "AWS (EC2, Lambda, ECS, S3, CloudFront, RDS, ElastiCache, OpenSearch)" → Extract: ["AWS", "EC2", "Lambda", "ECS", "S3", "CloudFront", "RDS", "ElastiCache", "OpenSearch"]
- "familiarity with GCP (BigQuery, Pub/Sub)" → Extract: ["GCP", "BigQuery", "Pub/Sub"]
- "experience with React, Vue, or Angular" → Extract: ["ReactJS", "Vue.js", "Angular"]
- "Knowledge of Docker and Kubernetes" → Extract: ["Docker", "Kubernetes"]
- "PostgreSQL, MySQL, or MongoDB" → Extract: ["PostgreSQL", "MySQL", "MongoDB"]
- "Python/Java backend development" → Extract: ["Python", "Java"]
- "REST APIs and GraphQL" → Extract: ["REST", "GraphQL"]
- "Spring Boot, Express.js, or Django" → Extract: ["Spring Boot", "Express", "Django"]
- "AWS, Azure, or GCP cloud platforms" → Extract: ["AWS", "Azure", "GCP"]
- "CI/CD tools like Jenkins, GitHub Actions" → Extract: ["Jenkins", "GitHub Actions"]
- "Experience with microservices architecture" → Extract: ["Microservices"] (architecture pattern)
- "Agile/Scrum methodologies" → Extract: ["Agile", "Scrum"] (methodologies)

Remember: Extract EVERYTHING mentioned, regardless of how it's phrased or where it appears in the JD.

Tech stack normalization - categorize properly:
- languages: Programming languages (Python, JavaScript, TypeScript, Java, Go, etc.)
- frameworks: Web/app frameworks (ReactJS, Next.js, FastAPI, Flask, Django, Node.js, Express, etc.)
- databases: All databases (PostgreSQL, MySQL, Snowflake, MongoDB, DynamoDB, Redis, etc.)
- devOps: Cloud services, containers, CI/CD, monitoring (AWS, EC2, Lambda, ECS, S3, CloudFront, Docker, Kubernetes, Helm, GitHub Actions, Jenkins, ArgoCD, Prometheus, Grafana, Loki, Jaeger, Open Telemetry, etc.)
- data: Data processing tools (PySpark, Pandas, NumPy, Spark, Airflow, dbt, Kafka, RabbitMQ, etc.)
- apis: API types/technologies (REST, GraphQL, etc.)
- testing: Testing frameworks/tools
- styling: CSS frameworks, styling tools
- collaborationTools: Team tools (Slack, Jira, etc.)
- stateManagement: State management libraries (if applicable)
- buildTools: Build tools (if applicable)
- packageManagers: Package managers (npm, pip, etc.)
- concepts: Concepts/patterns (if applicable)
- versionControl: Version control (Git, etc.)
- architecture: Architecture patterns (if applicable)
- methodologies: Development methodologies (Agile, etc.)
- designPrinciples: Design principles (if applicable)
- operatingSystems: Operating systems (if applicable)

Output format:
{
  "title": "exact title or ''",
  "company": "company name or ''",
  "companyPublisher": "publisher or null",
  "location": "full location or ''",
  "salaryMin": number_or_null,
  "salaryMax": number_or_null,
  "salaryCurrency": "USD|EUR|GBP|INR|etc or null",
  "salaryPeriod": "yearly|monthly|hourly or null",
  "salaryEstimated": boolean,
  "techStack": ["ALL mentioned tech/tools/skills - be comprehensive"],
  "techStackNormalized": {
    "languages": [], "frameworks": [], "databases": [], "devOps": [],
    "data": [], "apis": [], "testing": [], "styling": [], "collaborationTools": [],
    "stateManagement": [], "buildTools": [], "packageManagers": [], "concepts": [],
    "versionControl": [], "architecture": [], "methodologies": [], "designPrinciples": [],
    "operatingSystems": []
  },
  "role": "role name or title",
  "experience": "0-2 years|2+ years|Not specified",
  "jobType": "full-time|part-time|contract|on-site|remote|hybrid or null",
  "availability": "ASAP|Immediate|etc or null",
  "product": "product name or null",
  "seniority": "junior|mid|senior or null",
  "collaborationTools": ["Slack","Jira"] or null,
  "source": "LinkedIn|Indeed|etc or ''",
  "applicantsCount": number_or_null,
  "education": "degree requirements or null",
  "postedAt": "YYYY-MM-DD or null"
}

Seniority inference: lead/senior/principal/architect/manager→senior, junior/entry/associate/intern/0-2yrs→junior, mid/3-6yrs→mid
Experience extraction - CRITICAL PRIORITY RULES:
1. ALWAYS check BOTH Requirements AND Qualifications sections
2. If Requirements says "2+ years" BUT Qualifications says "0-2 years", ALWAYS use Qualifications (actual requirement)
3. Qualifications section typically contains the ACTUAL minimum requirement, Requirements may be aspirational
4. Example: Requirements: "2+ years" + Qualifications: "0-2 years" → Extract: "0-2 years"
5. If only one section exists, use that section
6. If both say the same thing, use that value
7. If conflicting, ALWAYS prioritize Qualifications section over Requirements section
Missing data: null for optional, "" for required strings, [] for arrays. No placeholders like "Unknown" or "N/A".`;

  cachedSystemPrompt = prompt;
  cachedSystemPromptDate = todayStr;
  return prompt;
}
