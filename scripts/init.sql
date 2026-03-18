CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- enables ILIKE/trigram indexes

-- ENUMs
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE public.job_status AS ENUM ('applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn');
  END IF;
END; $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'salary_period') THEN
    CREATE TYPE public.salary_period AS ENUM ('hourly', 'monthly', 'yearly');
  END IF;
END; $$;

-- Mirrors auth.users; upserted on every login
CREATE TABLE IF NOT EXISTS public.app_users (
  id         uuid        PRIMARY KEY,
  email      text        NOT NULL,
  name       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_users_email_idx ON public.app_users (email); -- auth lookup by email

-- Job applications
CREATE TABLE IF NOT EXISTS public.jobs (
  id                    uuid              PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid              UNIQUE,
  owner_id              uuid              NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  owner_email           text              NOT NULL,
  owner_name            text,
  title                 text              NOT NULL DEFAULT '',
  company               text              NOT NULL DEFAULT '',
  company_publisher     text,
  location              text              NOT NULL DEFAULT '',
  salary_min            numeric,
  salary_max            numeric,
  salary_currency       text,
  salary_period         public.salary_period,
  salary_estimated      boolean           NOT NULL DEFAULT false,
  tech_stack            text[]            NOT NULL DEFAULT '{}',
  tech_stack_normalized text,
  role                  text              NOT NULL DEFAULT '',
  experience            text              NOT NULL DEFAULT 'Not specified',
  job_type              text,
  availability          text,
  product               text,
  seniority             text,
  collaboration_tools   text[],
  status                public.job_status NOT NULL DEFAULT 'applied',
  applied_at            timestamptz       NOT NULL DEFAULT now(),
  posted_at             timestamptz,
  applicants_count      integer,
  education             text,
  source                text,
  jd_raw                text,
  notes                 text,
  created_at            timestamptz       NOT NULL DEFAULT now(),
  updated_at            timestamptz       NOT NULL DEFAULT now()
);

-- Jobs indexes: filtering, sorting, full-text search, ILIKE trigram search
CREATE INDEX IF NOT EXISTS jobs_owner_id_idx                   ON public.jobs (owner_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx                     ON public.jobs (status);
CREATE INDEX IF NOT EXISTS jobs_applied_at_idx                 ON public.jobs (applied_at DESC);
CREATE INDEX IF NOT EXISTS jobs_owner_id_applied_at_idx        ON public.jobs (owner_id, applied_at DESC);
CREATE INDEX IF NOT EXISTS jobs_owner_id_status_applied_at_idx ON public.jobs (owner_id, status, applied_at DESC);
CREATE INDEX IF NOT EXISTS jobs_title_idx                      ON public.jobs USING gin (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS jobs_company_idx                    ON public.jobs USING gin (to_tsvector('english', company));
CREATE INDEX IF NOT EXISTS jobs_title_trgm_idx                 ON public.jobs USING gin (title    gin_trgm_ops); -- ilike '%…%' search
CREATE INDEX IF NOT EXISTS jobs_company_trgm_idx               ON public.jobs USING gin (company  gin_trgm_ops); -- ilike '%…%' search
CREATE INDEX IF NOT EXISTS jobs_location_trgm_idx              ON public.jobs USING gin (location gin_trgm_ops); -- ilike '%…%' search
-- Combined fuzzy search index (best for multi-field queries)
CREATE INDEX IF NOT EXISTS jobs_search_text_trgm_idx           ON public.jobs USING gin ((concat_ws(' ', coalesce(title,''), coalesce(company,''), coalesce(location,''))) gin_trgm_ops);

-- Uploaded resumes (PDF text + parsed JSON)
CREATE TABLE IF NOT EXISTS public.resumes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  owner_email      text        NOT NULL,
  owner_name       text,
  name             text        NOT NULL,
  source_file_name text,
  file_size        integer,
  content_type     text        NOT NULL DEFAULT 'application/pdf',
  blob_pathname    text,
  content          text        NOT NULL DEFAULT '',
  parsed_content   text        NOT NULL DEFAULT '{}',
  is_verified      boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resumes_owner_id_idx         ON public.resumes (owner_id);
CREATE INDEX IF NOT EXISTS resumes_owner_updated_at_idx ON public.resumes (owner_id, updated_at DESC);

-- Maps Telegram chat_id to an authenticated user
CREATE TABLE IF NOT EXISTS public.telegram_chat_links (
  chat_id    text        PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  name       text,
  session_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_chat_links_user_id_idx ON public.telegram_chat_links (user_id);

-- Temporary OTP challenges for Telegram login flow
CREATE TABLE IF NOT EXISTS public.telegram_login_challenges (
  chat_id    text        PRIMARY KEY,
  email      text        NOT NULL,
  user_id    text        NOT NULL DEFAULT '',
  phrase     text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Generic sessions (telegram, browser)
CREATE TABLE IF NOT EXISTS public.sessions (
  session_id   uuid        NOT NULL DEFAULT gen_random_uuid(),
  session_type text        NOT NULL,
  identifier   text        NOT NULL,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id),
  UNIQUE (session_type, identifier)
);

-- Covering index serves (session_type, identifier) lookups + expires_at filter in one scan
CREATE INDEX IF NOT EXISTS sessions_type_identifier_expires_idx ON public.sessions (session_type, identifier, expires_at);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx              ON public.sessions (expires_at); -- bulk expiry cleanup

-- Email OTP records for custom auth (one active OTP per email)
CREATE TABLE IF NOT EXISTS public.email_otps (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text        NOT NULL,
  code_hash     text        NOT NULL,
  salt          text        NOT NULL,
  attempts      integer     NOT NULL DEFAULT 0,
  max_attempts  integer     NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  send_count    integer     NOT NULL DEFAULT 1,
  window_start  timestamptz NOT NULL DEFAULT now(),
  blocked_until timestamptz
);

-- unique index covers all email lookups; expires_at for cleanup of stale OTPs
CREATE UNIQUE INDEX IF NOT EXISTS email_otps_email_unique_idx ON public.email_otps (email);
CREATE INDEX        IF NOT EXISTS email_otps_expires_at_idx   ON public.email_otps (expires_at);

-- Rate limiting state per action/scope/key (email sends, verify attempts, etc.)
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
  action            text        NOT NULL,
  scope             text        NOT NULL,
  scope_key         text        NOT NULL,
  attempts          integer     NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  blocked_until     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (action, scope, scope_key)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_blocked_until_idx ON public.auth_rate_limits (blocked_until);

-- Shared trigger function to auto-update updated_at on row change
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_jobs_updated_at                ON public.jobs;
DROP TRIGGER IF EXISTS set_resumes_updated_at             ON public.resumes;
DROP TRIGGER IF EXISTS set_app_users_updated_at           ON public.app_users;
DROP TRIGGER IF EXISTS set_telegram_chat_links_updated_at ON public.telegram_chat_links;
DROP TRIGGER IF EXISTS set_auth_rate_limits_updated_at    ON public.auth_rate_limits;

CREATE TRIGGER set_jobs_updated_at                BEFORE UPDATE ON public.jobs                FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_resumes_updated_at             BEFORE UPDATE ON public.resumes             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_app_users_updated_at           BEFORE UPDATE ON public.app_users           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_telegram_chat_links_updated_at BEFORE UPDATE ON public.telegram_chat_links FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_auth_rate_limits_updated_at    BEFORE UPDATE ON public.auth_rate_limits    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
