import { dedupeArray } from "./utils";

export function filterFalsePositives(techStack: string[]): string[] {
  const falsePositives = new Set([
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

  const techSet = new Set(techStack.map((t) => t.toLowerCase()));
  const filtered: string[] = [];
  const removed: string[] = [];

  for (const tech of techStack) {
    const techLower = tech.toLowerCase();

    if (falsePositives.has(techLower)) {
      removed.push(tech);
      continue;
    }

    if (techLower === "apache") {
      const hasApacheProduct = Array.from(techSet).some(
        (t) => t.startsWith("apache ") && t !== "apache"
      );
      if (hasApacheProduct) {
        removed.push(tech);
        continue;
      }
    }

    if (techLower === "github") {
      if (techSet.has("github actions")) {
        removed.push(tech);
        continue;
      }
    }

    if (techLower === "kafka" && techSet.has("apache kafka")) {
      removed.push(tech);
      continue;
    }

    if (tech.length > 40 || tech.split(" ").length > 5) {
      const allowedLongTechs = [
        "azure synapse analytics",
        "azure data factory",
        "google cloud platform",
        "amazon web services",
      ];
      if (!allowedLongTechs.some((allowed) => techLower.includes(allowed))) {
        removed.push(tech);
        continue;
      }
    }

    filtered.push(tech);
  }

  if (process.env.NODE_ENV === "development" && removed.length > 0) {
    console.log(`[Parse] Filtered out ${removed.length} false positives:`, removed);
  }

  return filtered;
}

const TECH_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bjavascript\b/i, name: "JavaScript" },
  { pattern: /\btypescript\b/i, name: "TypeScript" },
  { pattern: /\bpython\b/i, name: "Python" },
  { pattern: /\bjava\b/i, name: "Java" },
  { pattern: /\bgo\b/i, name: "Go" },
  { pattern: /\bgolang\b/i, name: "Go" },
  { pattern: /\brust\b/i, name: "Rust" },
  { pattern: /\bc\+\+\b/i, name: "C++" },
  { pattern: /\bcpp\b/i, name: "C++" },
  { pattern: /\bc#\b/i, name: "C#" },
  { pattern: /\bcsharp\b/i, name: "C#" },
  { pattern: /\bphp\b/i, name: "PHP" },
  { pattern: /\bruby\b/i, name: "Ruby" },
  { pattern: /\bswift\b/i, name: "Swift" },
  { pattern: /\bkotlin\b/i, name: "Kotlin" },
  { pattern: /\bscala\b/i, name: "Scala" },
  { pattern: /\br\b/i, name: "R" },
  { pattern: /\bperl\b/i, name: "Perl" },
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
  { pattern: /\belastic beanstalk\b/i, name: "Elastic Beanstalk" },
  { pattern: /\bsns\b/i, name: "SNS" },
  { pattern: /\bsqs\b/i, name: "SQS" },
  { pattern: /\bapi gateway\b/i, name: "API Gateway" },
  { pattern: /\bapigateway\b/i, name: "API Gateway" },
  { pattern: /\bgcp\b/i, name: "GCP" },
  { pattern: /\bgoogle cloud\b/i, name: "GCP" },
  { pattern: /\bgoogle cloud platform\b/i, name: "GCP" },
  { pattern: /\bbigquery\b/i, name: "BigQuery" },
  { pattern: /\bpub\/sub\b/i, name: "Pub/Sub" },
  { pattern: /\bpubsub\b/i, name: "Pub/Sub" },
  { pattern: /\bcloud functions\b/i, name: "Cloud Functions" },
  { pattern: /\bcloud run\b/i, name: "Cloud Run" },
  { pattern: /\bcloud storage\b/i, name: "Cloud Storage" },
  { pattern: /\bcloud sql\b/i, name: "Cloud SQL" },
  { pattern: /\bcloud build\b/i, name: "Cloud Build" },
  { pattern: /\bcloud monitoring\b/i, name: "Cloud Monitoring" },
  { pattern: /\bazure\b/i, name: "Azure" },
  { pattern: /\bmicrosoft azure\b/i, name: "Azure" },
  { pattern: /\bdata factory\b/i, name: "Data Factory" },
  { pattern: /\bsynapse analytics\b/i, name: "Synapse Analytics" },
  { pattern: /\bsynapse\b/i, name: "Synapse Analytics" },
  { pattern: /\bazure functions\b/i, name: "Azure Functions" },
  { pattern: /\bazure app service\b/i, name: "Azure App Service" },
  { pattern: /\bazure storage\b/i, name: "Azure Storage" },
  { pattern: /\bazure sql\b/i, name: "Azure SQL" },
  { pattern: /\bazure devops\b/i, name: "Azure DevOps" },
  { pattern: /\bazure kubernetes service\b/i, name: "Azure Kubernetes Service" },
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
  { pattern: /\bexpress\.js\b/i, name: "Express" },
  { pattern: /\bvue\b/i, name: "Vue.js" },
  { pattern: /\bvue\.js\b/i, name: "Vue.js" },
  { pattern: /\bvuejs\b/i, name: "Vue.js" },
  { pattern: /\bangular\b/i, name: "Angular" },
  { pattern: /\bangularjs\b/i, name: "AngularJS" },
  { pattern: /\bsvelte\b/i, name: "Svelte" },
  { pattern: /\bember\b/i, name: "Ember.js" },
  { pattern: /\bspring\b/i, name: "Spring" },
  { pattern: /\bspring boot\b/i, name: "Spring Boot" },
  { pattern: /\bspringboot\b/i, name: "Spring Boot" },
  { pattern: /\blaravel\b/i, name: "Laravel" },
  { pattern: /\bruby on rails\b/i, name: "Ruby on Rails" },
  { pattern: /\brails\b/i, name: "Ruby on Rails" },
  { pattern: /\basp\.net\b/i, name: "ASP.NET" },
  { pattern: /\baspnet\b/i, name: "ASP.NET" },
  { pattern: /\b\.net\b/i, name: ".NET" },
  { pattern: /\bdotnet\b/i, name: ".NET" },
  { pattern: /\bpostgresql\b/i, name: "PostgreSQL" },
  { pattern: /\bpostgres\b/i, name: "PostgreSQL" },
  { pattern: /\bmysql\b/i, name: "MySQL" },
  { pattern: /\bsnowflake\b/i, name: "Snowflake" },
  { pattern: /\bmongodb\b/i, name: "MongoDB" },
  { pattern: /\bdynamodb\b/i, name: "DynamoDB" },
  { pattern: /\bredis\b/i, name: "Redis" },
  { pattern: /\bcassandra\b/i, name: "Cassandra" },
  { pattern: /\bcouchdb\b/i, name: "CouchDB" },
  { pattern: /\belasticsearch\b/i, name: "Elasticsearch" },
  { pattern: /\belastic search\b/i, name: "Elasticsearch" },
  { pattern: /\bsqlite\b/i, name: "SQLite" },
  { pattern: /\boracle\b/i, name: "Oracle" },
  { pattern: /\bsql server\b/i, name: "SQL Server" },
  { pattern: /\bsqlserver\b/i, name: "SQL Server" },
  { pattern: /\bmariadb\b/i, name: "MariaDB" },
  { pattern: /\bneo4j\b/i, name: "Neo4j" },
  { pattern: /\binfluxdb\b/i, name: "InfluxDB" },
  { pattern: /\btimescaledb\b/i, name: "TimescaleDB" },
  { pattern: /\bpyspark\b/i, name: "PySpark" },
  { pattern: /\bpandas\b/i, name: "Pandas" },
  { pattern: /\bnumpy\b/i, name: "NumPy" },
  { pattern: /\bspark\b/i, name: "Spark" },
  { pattern: /\bapache spark\b/i, name: "Spark" },
  { pattern: /\bairflow\b/i, name: "Airflow" },
  { pattern: /\bapache airflow\b/i, name: "Airflow" },
  { pattern: /\bdbt\b/i, name: "dbt" },
  { pattern: /\bmatplotlib\b/i, name: "Matplotlib" },
  { pattern: /\bseaborn\b/i, name: "Seaborn" },
  { pattern: /\bplotly\b/i, name: "Plotly" },
  { pattern: /\bjupyter\b/i, name: "Jupyter" },
  { pattern: /\bjupyter notebook\b/i, name: "Jupyter" },
  { pattern: /\bdatabricks\b/i, name: "Databricks" },
  { pattern: /\bpresto\b/i, name: "Presto" },
  { pattern: /\btrino\b/i, name: "Trino" },
  { pattern: /\bhadoop\b/i, name: "Hadoop" },
  { pattern: /\bhive\b/i, name: "Hive" },
  { pattern: /\bimpala\b/i, name: "Impala" },
  { pattern: /\bapache kafka\b/i, name: "Apache Kafka" },
  { pattern: /\bkafka\b/i, name: "Apache Kafka" },
  { pattern: /\brabbitmq\b/i, name: "RabbitMQ" },
  { pattern: /\bscikit-learn\b/i, name: "Scikit-learn" },
  { pattern: /\bscikitlearn\b/i, name: "Scikit-learn" },
  { pattern: /\bsklearn\b/i, name: "Scikit-learn" },
  { pattern: /\btensorflow\b/i, name: "TensorFlow" },
  { pattern: /\bpytorch\b/i, name: "PyTorch" },
  { pattern: /\bkeras\b/i, name: "Keras" },
  { pattern: /\bxgboost\b/i, name: "XGBoost" },
  { pattern: /\blightgbm\b/i, name: "LightGBM" },
  { pattern: /\bcatboost\b/i, name: "CatBoost" },
  { pattern: /\bopencv\b/i, name: "OpenCV" },
  { pattern: /\bnltk\b/i, name: "NLTK" },
  { pattern: /\bspacy\b/i, name: "spaCy" },
  { pattern: /\btransformers\b/i, name: "Transformers" },
  { pattern: /\bhugging face\b/i, name: "Hugging Face" },
  { pattern: /\bhuggingface\b/i, name: "Hugging Face" },
  { pattern: /\bmlflow\b/i, name: "MLflow" },
  { pattern: /\bkubeflow\b/i, name: "Kubeflow" },
  { pattern: /\bweights & biases\b/i, name: "Weights & Biases" },
  { pattern: /\bwandb\b/i, name: "Weights & Biases" },
  { pattern: /\bcomet\b/i, name: "Comet" },
  { pattern: /\bneptune\b/i, name: "Neptune" },
  { pattern: /\bsagemaker\b/i, name: "AWS SageMaker" },
  { pattern: /\baws sagemaker\b/i, name: "AWS SageMaker" },
  { pattern: /\bamazon sagemaker\b/i, name: "AWS SageMaker" },
  { pattern: /\bvertex ai\b/i, name: "Vertex AI" },
  { pattern: /\bgcp vertex ai\b/i, name: "Vertex AI" },
  { pattern: /\bgoogle vertex ai\b/i, name: "Vertex AI" },
  { pattern: /\bazure ml\b/i, name: "Azure ML" },
  { pattern: /\bazure machine learning\b/i, name: "Azure ML" },
  { pattern: /\bazure machine learning studio\b/i, name: "Azure ML" },
  { pattern: /\bdomino\b/i, name: "Domino" },
  { pattern: /\bdataiku\b/i, name: "Dataiku" },
  { pattern: /\bdocker\b/i, name: "Docker" },
  { pattern: /\bkubernetes\b/i, name: "Kubernetes" },
  { pattern: /\bk8s\b/i, name: "Kubernetes" },
  { pattern: /\bhelm\b/i, name: "Helm" },
  { pattern: /\bgithub actions\b/i, name: "GitHub Actions" },
  { pattern: /\bjenkins\b/i, name: "Jenkins" },
  { pattern: /\bargocd\b/i, name: "ArgoCD" },
  { pattern: /\bargo cd\b/i, name: "ArgoCD" },
  { pattern: /\bgitlab ci\b/i, name: "GitLab CI" },
  { pattern: /\bgitlab\b/i, name: "GitLab" },
  { pattern: /\bcircleci\b/i, name: "CircleCI" },
  { pattern: /\bcircle ci\b/i, name: "CircleCI" },
  { pattern: /\btravis ci\b/i, name: "Travis CI" },
  { pattern: /\btravis\b/i, name: "Travis CI" },
  { pattern: /\bteamcity\b/i, name: "TeamCity" },
  { pattern: /\bbamboo\b/i, name: "Bamboo" },
  { pattern: /\bgithub\b/i, name: "GitHub" },
  { pattern: /\bgit\b/i, name: "Git" },
  { pattern: /\bgitlab\b/i, name: "GitLab" },
  { pattern: /\bbitbucket\b/i, name: "Bitbucket" },
  { pattern: /\bprometheus\b/i, name: "Prometheus" },
  { pattern: /\bgrafana\b/i, name: "Grafana" },
  { pattern: /\bloki\b/i, name: "Loki" },
  { pattern: /\bjaeger\b/i, name: "Jaeger" },
  { pattern: /\bopen telemetry\b/i, name: "Open Telemetry" },
  { pattern: /\bopentelemetry\b/i, name: "Open Telemetry" },
  { pattern: /\brest\b/i, name: "REST" },
  { pattern: /\bgraphql\b/i, name: "GraphQL" },
  { pattern: /\bvault\b/i, name: "Vault" },
  { pattern: /\bhashi corp vault\b/i, name: "Vault" },
  { pattern: /\blet's encrypt\b/i, name: "Let's Encrypt" },
  { pattern: /\bletsencrypt\b/i, name: "Let's Encrypt" },
  { pattern: /\bokta\b/i, name: "Okta" },
  { pattern: /\bauth0\b/i, name: "Auth0" },
  { pattern: /\boauth\b/i, name: "OAuth" },
  { pattern: /\bjwt\b/i, name: "JWT" },
  { pattern: /\bjson web token\b/i, name: "JWT" },
  { pattern: /\bsaml\b/i, name: "SAML" },
  { pattern: /\bldap\b/i, name: "LDAP" },
  { pattern: /\bjest\b/i, name: "Jest" },
  { pattern: /\bmocha\b/i, name: "Mocha" },
  { pattern: /\bchai\b/i, name: "Chai" },
  { pattern: /\bcypress\b/i, name: "Cypress" },
  { pattern: /\bplaywright\b/i, name: "Playwright" },
  { pattern: /\bselenium\b/i, name: "Selenium" },
  { pattern: /\bpytest\b/i, name: "pytest" },
  { pattern: /\bunittest\b/i, name: "unittest" },
  { pattern: /\bjunit\b/i, name: "JUnit" },
  { pattern: /\btestng\b/i, name: "TestNG" },
  { pattern: /\bvitest\b/i, name: "Vitest" },
  { pattern: /\bredux\b/i, name: "Redux" },
  { pattern: /\bmobx\b/i, name: "MobX" },
  { pattern: /\bzustand\b/i, name: "Zustand" },
  { pattern: /\bpinia\b/i, name: "Pinia" },
  { pattern: /\bvuex\b/i, name: "Vuex" },
  { pattern: /\bwebpack\b/i, name: "Webpack" },
  { pattern: /\bvite\b/i, name: "Vite" },
  { pattern: /\brollup\b/i, name: "Rollup" },
  { pattern: /\bparcel\b/i, name: "Parcel" },
  { pattern: /\besbuild\b/i, name: "esbuild" },
  { pattern: /\bbabel\b/i, name: "Babel" },
  { pattern: /\btypescript\b/i, name: "TypeScript" },
  { pattern: /\beslint\b/i, name: "ESLint" },
  { pattern: /\bprettier\b/i, name: "Prettier" },
  { pattern: /\bnpm\b/i, name: "npm" },
  { pattern: /\byarn\b/i, name: "Yarn" },
  { pattern: /\bpnpm\b/i, name: "pnpm" },
  { pattern: /\bpip\b/i, name: "pip" },
  { pattern: /\bconda\b/i, name: "Conda" },
  { pattern: /\bpoetry\b/i, name: "Poetry" },
  { pattern: /\bmaven\b/i, name: "Maven" },
  { pattern: /\bgradle\b/i, name: "Gradle" },
  { pattern: /\bcomposer\b/i, name: "Composer" },
  { pattern: /\bcargo\b/i, name: "Cargo" },
  { pattern: /\bslack\b/i, name: "Slack" },
  { pattern: /\bjira\b/i, name: "Jira" },
  { pattern: /\bconfluence\b/i, name: "Confluence" },
  { pattern: /\bnotion\b/i, name: "Notion" },
  { pattern: /\basana\b/i, name: "Asana" },
  { pattern: /\btrello\b/i, name: "Trello" },
  { pattern: /\bfigma\b/i, name: "Figma" },
  { pattern: /\bsketch\b/i, name: "Sketch" },
  { pattern: /\bzoom\b/i, name: "Zoom" },
  { pattern: /\bteams\b/i, name: "Microsoft Teams" },
  { pattern: /\bmicrosoft teams\b/i, name: "Microsoft Teams" },
  { pattern: /\bcss\b/i, name: "CSS" },
  { pattern: /\bsass\b/i, name: "SASS" },
  { pattern: /\bscss\b/i, name: "SCSS" },
  { pattern: /\bless\b/i, name: "Less" },
  { pattern: /\bstyled-components\b/i, name: "Styled Components" },
  { pattern: /\bemotion\b/i, name: "Emotion" },
  { pattern: /\btailwind css\b/i, name: "Tailwind CSS" },
  { pattern: /\btailwind\b/i, name: "Tailwind CSS" },
  { pattern: /\bbootstrap\b/i, name: "Bootstrap" },
  { pattern: /\bmaterial-ui\b/i, name: "Material-UI" },
  { pattern: /\bmui\b/i, name: "Material-UI" },
  { pattern: /\bant design\b/i, name: "Ant Design" },
  { pattern: /\bantd\b/i, name: "Ant Design" },
  { pattern: /\btableau\b/i, name: "Tableau" },
  { pattern: /\bpower bi\b/i, name: "Power BI" },
  { pattern: /\bpowerbi\b/i, name: "Power BI" },
  { pattern: /\bexcel\b/i, name: "Excel" },
  { pattern: /\bmicrosoft excel\b/i, name: "Excel" },
  { pattern: /\bsql\b/i, name: "SQL" },
  { pattern: /\bqlik\b/i, name: "Qlik" },
  { pattern: /\bqlikview\b/i, name: "QlikView" },
  { pattern: /\bqliksense\b/i, name: "QlikSense" },
  { pattern: /\blooker\b/i, name: "Looker" },
  { pattern: /\bmetabase\b/i, name: "Metabase" },
  { pattern: /\bsuperset\b/i, name: "Apache Superset" },
  { pattern: /\bapache superset\b/i, name: "Apache Superset" },
  { pattern: /\bsas\b/i, name: "SAS" },
  { pattern: /\bspss\b/i, name: "SPSS" },
  { pattern: /\bstata\b/i, name: "Stata" },
  { pattern: /\bmatlab\b/i, name: "MATLAB" },
  { pattern: /\bgoogle analytics\b/i, name: "Google Analytics" },
  { pattern: /\bgoogleanalytics\b/i, name: "Google Analytics" },
  { pattern: /\bamplitude\b/i, name: "Amplitude" },
  { pattern: /\bmixpanel\b/i, name: "Mixpanel" },
  { pattern: /\bsegment\b/i, name: "Segment" },
  { pattern: /\bredshift\b/i, name: "Redshift" },
  { pattern: /\bamazon redshift\b/i, name: "Redshift" },
  { pattern: /\balteryx\b/i, name: "Alteryx" },
  { pattern: /\bknime\b/i, name: "KNIME" },
  { pattern: /\brapidminer\b/i, name: "RapidMiner" },
  { pattern: /\bpagerduty\b/i, name: "PagerDuty" },
  { pattern: /\bopsgenie\b/i, name: "Opsgenie" },
  { pattern: /\bdatadog\b/i, name: "Datadog" },
  { pattern: /\bnew relic\b/i, name: "New Relic" },
  { pattern: /\bnewrelic\b/i, name: "New Relic" },
  { pattern: /\bsplunk\b/i, name: "Splunk" },
  { pattern: /\belk stack\b/i, name: "ELK Stack" },
  { pattern: /\belastic stack\b/i, name: "ELK Stack" },
  { pattern: /\belastic\b/i, name: "Elasticsearch" },
  { pattern: /\blogstash\b/i, name: "Logstash" },
  { pattern: /\bkibana\b/i, name: "Kibana" },
  { pattern: /\bansible\b/i, name: "Ansible" },
  { pattern: /\bpuppet\b/i, name: "Puppet" },
  { pattern: /\bchef\b/i, name: "Chef" },
  { pattern: /\bsaltstack\b/i, name: "SaltStack" },
  { pattern: /\bconsul\b/i, name: "Consul" },
  { pattern: /\bnomad\b/i, name: "Nomad" },
  { pattern: /\bistio\b/i, name: "Istio" },
  { pattern: /\blinkerd\b/i, name: "Linkerd" },
  { pattern: /\benvoy\b/i, name: "Envoy" },
  { pattern: /\bnginx\b/i, name: "Nginx" },
  { pattern: /\bapache\b/i, name: "Apache" },
  { pattern: /\bapache http server\b/i, name: "Apache HTTP Server" },
  { pattern: /\bpulumi\b/i, name: "Pulumi" },
  { pattern: /\bcrossplane\b/i, name: "Crossplane" },
  { pattern: /\bpacker\b/i, name: "Packer" },
  { pattern: /\bzipkin\b/i, name: "Zipkin" },
  { pattern: /\bsentry\b/i, name: "Sentry" },
  { pattern: /\brollbar\b/i, name: "Rollbar" },
  { pattern: /\bappdynamics\b/i, name: "AppDynamics" },
  { pattern: /\bdynatrace\b/i, name: "Dynatrace" },
  { pattern: /\breact native\b/i, name: "React Native" },
  { pattern: /\breactnative\b/i, name: "React Native" },
  { pattern: /\bflutter\b/i, name: "Flutter" },
  { pattern: /\bionic\b/i, name: "Ionic" },
  { pattern: /\bxamarin\b/i, name: "Xamarin" },
  { pattern: /\bcordova\b/i, name: "Cordova" },
  { pattern: /\bphonegap\b/i, name: "PhoneGap" },
  { pattern: /\bandroid\b/i, name: "Android" },
  { pattern: /\bios\b/i, name: "iOS" },
  { pattern: /\bkotlin\b/i, name: "Kotlin" },
  { pattern: /\bswift\b/i, name: "Swift" },
  { pattern: /\bobjective-c\b/i, name: "Objective-C" },
  { pattern: /\bobjectivec\b/i, name: "Objective-C" },
  { pattern: /\bobjc\b/i, name: "Objective-C" },
  { pattern: /\bweights & biases\b/i, name: "Weights & Biases" },
  { pattern: /\bwandb\b/i, name: "Weights & Biases" },
  { pattern: /\bcomet\b/i, name: "Comet" },
  { pattern: /\bneptune\b/i, name: "Neptune" },
  { pattern: /\bdomino\b/i, name: "Domino" },
  { pattern: /\bdataiku\b/i, name: "Dataiku" },
  { pattern: /\bh2o\b/i, name: "H2O" },
  { pattern: /\brapids\b/i, name: "RAPIDS" },
  { pattern: /\bray\b/i, name: "Ray" },
  { pattern: /\bhorovod\b/i, name: "Horovod" },
  { pattern: /\boptuna\b/i, name: "Optuna" },
  { pattern: /\bhyperopt\b/i, name: "Hyperopt" },
  { pattern: /\bairflow\b/i, name: "Airflow" },
  { pattern: /\bprefect\b/i, name: "Prefect" },
  { pattern: /\bluigi\b/i, name: "Luigi" },
  { pattern: /\bdagster\b/i, name: "Dagster" },
  { pattern: /\basyncio\b/i, name: "AsyncIO" },
  { pattern: /\basync io\b/i, name: "AsyncIO" },
  { pattern: /\boperators\b/i, name: "Operators" },
  { pattern: /\bkubernetes operators\b/i, name: "Operators" },
];

const COMPOUND_PATTERNS: Array<{ pattern: RegExp; names: string[] }> = [
  { pattern: /\bjavascript\s*\/\s*typescript\b/i, names: ["JavaScript", "TypeScript"] },
  { pattern: /\btypescript\s*\/\s*javascript\b/i, names: ["TypeScript", "JavaScript"] },
];

const PAREN_PATTERNS = [
  /(AWS|GCP|Azure)\s+services\s*\(([^)]+)\)/gi,
  /(?:familiarity\s+with|experience\s+with|knowledge\s+of|proficiency\s+in)\s+(AWS|GCP|Azure)\s*\(([^)]+)\)/gi,
  /(AWS|GCP|Azure)\s*\(([^)]+)\)/gi,
  /(Python|JavaScript|TypeScript|Java|Go|Rust|C\+\+|C#|PHP|Ruby|Swift|Kotlin|Scala|R)\s*\(([^)]+)\)/gi,
  /(\w+(?:\s+\w+)*)\s*\(([^)]+)\)/gi,
];

const DIRECT_PATTERNS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\bRDS\b/i, name: "RDS" },
  { pattern: /\bAmazon\s+RDS\b/i, name: "RDS" },
  { pattern: /\bAWS\s+RDS\b/i, name: "RDS" },
  { pattern: /\bElastiCache\b/i, name: "ElastiCache" },
  { pattern: /\bAmazon\s+ElastiCache\b/i, name: "ElastiCache" },
  { pattern: /\bAWS\s+ElastiCache\b/i, name: "ElastiCache" },
  { pattern: /\bOpenSearch\b/i, name: "OpenSearch" },
  { pattern: /\bAmazon\s+OpenSearch\b/i, name: "OpenSearch" },
  { pattern: /\bAWS\s+OpenSearch\b/i, name: "OpenSearch" },
  { pattern: /\bGCP\b/i, name: "GCP" },
  { pattern: /\bGoogle\s+Cloud\s+Platform\b/i, name: "GCP" },
  { pattern: /\bGoogle\s+Cloud\b/i, name: "GCP" },
  { pattern: /\bBigQuery\b/i, name: "BigQuery" },
  { pattern: /\bGoogle\s+BigQuery\b/i, name: "BigQuery" },
  { pattern: /\bPub\/Sub\b/i, name: "Pub/Sub" },
  { pattern: /\bPubSub\b/i, name: "Pub/Sub" },
  { pattern: /\bGoogle\s+Pub\/Sub\b/i, name: "Pub/Sub" },
  { pattern: /\bGoogle\s+PubSub\b/i, name: "Pub/Sub" },
  { pattern: /\bAzure\b/i, name: "Azure" },
  { pattern: /\bMicrosoft\s+Azure\b/i, name: "Azure" },
  { pattern: /\bData\s+Factory\b/i, name: "Data Factory" },
  { pattern: /\bAzure\s+Data\s+Factory\b/i, name: "Data Factory" },
  { pattern: /\bSynapse\s+Analytics\b/i, name: "Synapse Analytics" },
  { pattern: /\bAzure\s+Synapse\s+Analytics\b/i, name: "Synapse Analytics" },
  { pattern: /\bAzure\s+Synapse\b/i, name: "Synapse Analytics" },
  { pattern: /\bAsyncIO\b/i, name: "AsyncIO" },
  { pattern: /\bAsync\s+IO\b/i, name: "AsyncIO" },
  { pattern: /\bPython\s+AsyncIO\b/i, name: "AsyncIO" },
  { pattern: /\basyncio\b/i, name: "AsyncIO" },
];

const SERVICE_MAP: Record<string, string> = {
  rds: "RDS",
  "amazon rds": "RDS",
  elasticache: "ElastiCache",
  "amazon elasticache": "ElastiCache",
  opensearch: "OpenSearch",
  "amazon opensearch": "OpenSearch",
  "aws opensearch": "OpenSearch",
  ec2: "EC2",
  "amazon ec2": "EC2",
  lambda: "Lambda",
  "aws lambda": "Lambda",
  ecs: "ECS",
  "amazon ecs": "ECS",
  s3: "S3",
  "amazon s3": "S3",
  cloudfront: "CloudFront",
  "amazon cloudfront": "CloudFront",
  bigquery: "BigQuery",
  "google bigquery": "BigQuery",
  "pub/sub": "Pub/Sub",
  pubsub: "Pub/Sub",
  "google pub/sub": "Pub/Sub",
  "google pubsub": "Pub/Sub",
  "data factory": "Data Factory",
  "azure data factory": "Data Factory",
  "synapse analytics": "Synapse Analytics",
  synapse: "Synapse Analytics",
  "azure synapse": "Synapse Analytics",
  "azure synapse analytics": "Synapse Analytics",
  asyncio: "AsyncIO",
  "async io": "AsyncIO",
  "python asyncio": "AsyncIO",
  operators: "Operators",
  "kubernetes operators": "Operators",
  "k8s operators": "Operators",
};

export function extractTechFromJDText(jdText: string, existingTechStack: string[]): string[] {
  const existingSet = new Set(existingTechStack.map((t) => t.toLowerCase()));
  const found: string[] = [];

  const isDebug = process.env.NODE_ENV === "development";
  const jdLength = jdText.length;
  const techStackSize = existingTechStack.length;

  if (isDebug) {
    console.log(
      `[TechExtract] Starting extraction from JD (${jdLength} chars), existing techs: ${techStackSize}`
    );
  }

  const skipPatternMatching = techStackSize >= 50 && jdLength < 10_000;

  let patternMatches = 0;
  if (!skipPatternMatching) {
    for (const { pattern, name } of TECH_PATTERNS) {
      if (pattern.test(jdText) && !existingSet.has(name.toLowerCase())) {
        found.push(name);
        existingSet.add(name.toLowerCase());
        patternMatches++;
        if (isDebug && patternMatches <= 10) {
          console.log(`[TechExtract] Pattern matched: ${name}`);
        }
      }
    }

    if (isDebug) {
      console.log(`[TechExtract] Pattern matching found ${patternMatches} technologies`);
    }
  } else if (isDebug) {
    console.log(
      `[TechExtract] Skipping pattern matching (tech stack comprehensive: ${techStackSize} items)`
    );
  }

  for (const { pattern, names } of COMPOUND_PATTERNS) {
    if (pattern.test(jdText)) {
      for (const name of names) {
        if (!existingSet.has(name.toLowerCase())) {
          found.push(name);
          existingSet.add(name.toLowerCase());
        }
      }
    }
  }

  const processedMatches = new Set<string>();
  let parenMatches = 0;

  for (let i = 0; i < PAREN_PATTERNS.length; i++) {
    const parenPattern = PAREN_PATTERNS[i];
    parenPattern.lastIndex = 0;
    let match;
    let matchCount = 0;

    while ((match = parenPattern.exec(jdText)) !== null) {
      const matchKey = `${match[0]}-${match.index}-${i}`;
      if (processedMatches.has(matchKey)) continue;
      processedMatches.add(matchKey);
      matchCount++;

      const platform = match[1]?.trim();
      const servicesStr = match[2]?.trim();

      if (!platform || !servicesStr) {
        if (isDebug && matchCount <= 3) {
          console.log(
            `[TechExtract] Skipping match - platform: "${platform}", services: "${servicesStr}"`
          );
        }
        continue;
      }

      if (isDebug && matchCount <= 5) {
        console.log(`[TechExtract] Parentheses match (pattern ${i + 1}): "${match[0]}"`);
      }

      const platformUpper = platform.toUpperCase();
      const isCloudPlatform = ["AWS", "GCP", "AZURE"].includes(platformUpper);

      if (isCloudPlatform) {
        const platformName = platformUpper === "AZURE" ? "Azure" : platformUpper;
        if (!existingSet.has(platformName.toLowerCase())) {
          found.push(platformName);
          existingSet.add(platformName.toLowerCase());
          parenMatches++;
          if (isDebug) {
            console.log(`[TechExtract] Added cloud platform: ${platformName}`);
          }
        }
      }

      const services = servicesStr
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      for (const service of services) {
        const normalizedService = service.trim();
        if (!normalizedService || existingSet.has(normalizedService.toLowerCase())) {
          continue;
        }

        const serviceLower = normalizedService.toLowerCase();
        const mappedService = SERVICE_MAP[serviceLower] || normalizedService;

        const knownTech = TECH_PATTERNS.find((tp) => {
          const techLower = tp.name.toLowerCase();
          return techLower === serviceLower || techLower === mappedService.toLowerCase();
        });

        if (knownTech) {
          if (!existingSet.has(knownTech.name.toLowerCase())) {
            found.push(knownTech.name);
            existingSet.add(knownTech.name.toLowerCase());
            parenMatches++;
            if (isDebug) {
              console.log(`[TechExtract] Added from parentheses (known tech): ${knownTech.name}`);
            }
          }
        } else if (mappedService !== normalizedService) {
          if (!existingSet.has(mappedService.toLowerCase())) {
            found.push(mappedService);
            existingSet.add(mappedService.toLowerCase());
            parenMatches++;
            if (isDebug) {
              console.log(
                `[TechExtract] Added from parentheses (mapped): ${mappedService} (from "${normalizedService}")`
              );
            }
          }
        } else {
          if (/^[A-Z][a-zA-Z0-9\s\/\-&]+$/.test(normalizedService)) {
            found.push(normalizedService);
            existingSet.add(normalizedService.toLowerCase());
            parenMatches++;
            if (isDebug) {
              console.log(`[TechExtract] Added from parentheses (as-is): ${normalizedService}`);
            }
          }
        }
      }
    }

    if (isDebug && matchCount > 0) {
      console.log(`[TechExtract] Pattern ${i + 1} found ${matchCount} matches`);
    }
  }

  if (isDebug) {
    console.log(`[TechExtract] Parentheses extraction found ${parenMatches} technologies`);
  }

  let directMatches = 0;
  for (const { pattern, name } of DIRECT_PATTERNS) {
    if (pattern.test(jdText) && !existingSet.has(name.toLowerCase())) {
      found.push(name);
      existingSet.add(name.toLowerCase());
      directMatches++;
      if (isDebug) {
        console.log(`[TechExtract] Direct pattern matched: ${name}`);
      }
    }
  }

  if (isDebug) {
    console.log(`[TechExtract] Direct pattern matching found ${directMatches} technologies`);
    console.log(
      `[TechExtract] Total new technologies found: ${found.length} (existing: ${existingTechStack.length})`
    );
  }

  return dedupeArray(found);
}
