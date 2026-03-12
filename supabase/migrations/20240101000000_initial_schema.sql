-- ============================================================
-- Job Application Tracker — Initial Schema
-- ============================================================
-- Tables: jobs, resumes, app_users,
--         telegram_chat_links, telegram_login_challenges, sessions
-- ============================================================

-- Enable pgcrypto for gen_random_uuid() on older PG versions
-- (Supabase already enables this by default; included for safety)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── app_users ───────────────────────────────────────────────────────────────
-- Mirrors auth.users; updated on every login via upsertAppUser().

CREATE TABLE IF NOT EXISTS public.app_users (
  id          uuid        PRIMARY KEY,          -- matches auth.users.id
  email       text        NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- Users can only read/update their own record.
CREATE POLICY "app_users: owner read"
  ON public.app_users FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "app_users: owner update"
  ON public.app_users FOR UPDATE
  USING (auth.uid() = id);

-- Service role (edge functions) can upsert freely.
CREATE POLICY "app_users: service role all"
  ON public.app_users FOR ALL
  USING (auth.role() = 'service_role');

-- ─── jobs ─────────────────────────────────────────────────────────────────────

CREATE TYPE public.job_status AS ENUM (
  'applied', 'screening', 'interview', 'offer', 'rejected', 'withdrawn'
);

CREATE TYPE public.salary_period AS ENUM (
  'hourly', 'monthly', 'yearly'
);

CREATE TABLE IF NOT EXISTS public.jobs (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id                uuid        UNIQUE,                 -- same as id, kept for compat
  owner_id              uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  owner_email           text        NOT NULL,
  owner_name            text,

  title                 text        NOT NULL DEFAULT '',
  company               text        NOT NULL DEFAULT '',
  company_publisher     text,
  location              text        NOT NULL DEFAULT '',

  salary_min            numeric,
  salary_max            numeric,
  salary_currency       text,
  salary_period         public.salary_period,
  salary_estimated      boolean     NOT NULL DEFAULT false,

  tech_stack            text[]      NOT NULL DEFAULT '{}',
  tech_stack_normalized text,                               -- JSON string

  role                  text        NOT NULL DEFAULT '',
  experience            text        NOT NULL DEFAULT 'Not specified',
  job_type              text,
  availability          text,
  product               text,
  seniority             text,
  collaboration_tools   text[],

  status                public.job_status NOT NULL DEFAULT 'applied',
  applied_at            timestamptz NOT NULL DEFAULT now(),
  posted_at             timestamptz,
  applicants_count      integer,
  education             text,
  source                text,
  jd_raw                text,
  notes                 text,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS jobs_owner_id_idx    ON public.jobs (owner_id);
CREATE INDEX IF NOT EXISTS jobs_status_idx      ON public.jobs (status);
CREATE INDEX IF NOT EXISTS jobs_applied_at_idx  ON public.jobs (applied_at DESC);
CREATE INDEX IF NOT EXISTS jobs_title_idx       ON public.jobs USING gin (to_tsvector('english', title));
CREATE INDEX IF NOT EXISTS jobs_company_idx     ON public.jobs USING gin (to_tsvector('english', company));

ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jobs: owner all"
  ON public.jobs FOR ALL
  USING (owner_id = auth.uid());

CREATE POLICY "jobs: service role all"
  ON public.jobs FOR ALL
  USING (auth.role() = 'service_role');

-- ─── resumes ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.resumes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id         uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  owner_email      text        NOT NULL,
  owner_name       text,

  name             text        NOT NULL,
  source_file_name text,
  file_size        integer,
  content_type     text        NOT NULL DEFAULT 'application/pdf',

  content          text        NOT NULL DEFAULT '',     -- full extracted text
  parsed_content   text        NOT NULL DEFAULT '{}',  -- JSON: ParsedResume
  is_verified      boolean     NOT NULL DEFAULT false,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS resumes_owner_id_idx ON public.resumes (owner_id);

ALTER TABLE public.resumes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "resumes: owner all"
  ON public.resumes FOR ALL
  USING (owner_id = auth.uid());

CREATE POLICY "resumes: service role all"
  ON public.resumes FOR ALL
  USING (auth.role() = 'service_role');

-- ─── telegram_chat_links ──────────────────────────────────────────────────────
-- Maps a Telegram chat_id to an authenticated Supabase user.

CREATE TABLE IF NOT EXISTS public.telegram_chat_links (
  chat_id     text        PRIMARY KEY,   -- Telegram chat ID as string
  user_id     uuid        NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
  email       text        NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS telegram_chat_links_user_id_idx ON public.telegram_chat_links (user_id);

ALTER TABLE public.telegram_chat_links ENABLE ROW LEVEL SECURITY;

-- Only service role can manage telegram chat links (used only from edge functions)
CREATE POLICY "telegram_chat_links: service role all"
  ON public.telegram_chat_links FOR ALL
  USING (auth.role() = 'service_role');

-- ─── telegram_login_challenges ────────────────────────────────────────────────
-- Temporary OTP challenges pending verification from Telegram.

CREATE TABLE IF NOT EXISTS public.telegram_login_challenges (
  chat_id     text        PRIMARY KEY,   -- Telegram chat ID as string
  email       text        NOT NULL,
  user_id     text        NOT NULL DEFAULT '',  -- populated after Supabase OTP sent
  phrase      text,                             -- optional security phrase (legacy Appwrite field)
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_login_challenges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "telegram_login_challenges: service role all"
  ON public.telegram_login_challenges FOR ALL
  USING (auth.role() = 'service_role');

-- ─── sessions ─────────────────────────────────────────────────────────────────
-- Generic session table.  session_type='telegram' tracks unlocked Telegram chats.
-- session_type='browser' can track browser sessions (if not delegating to Supabase Auth).

CREATE TABLE IF NOT EXISTS public.sessions (
  session_id    uuid        NOT NULL DEFAULT gen_random_uuid(),
  session_type  text        NOT NULL,   -- e.g. 'telegram', 'browser'
  identifier    text        NOT NULL,   -- chatId (as string), user email, etc.
  expires_at    timestamptz NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (session_id),
  UNIQUE (session_type, identifier)
);

CREATE INDEX IF NOT EXISTS sessions_type_identifier_idx ON public.sessions (session_type, identifier);
CREATE INDEX IF NOT EXISTS sessions_expires_at_idx      ON public.sessions (expires_at);

ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sessions: service role all"
  ON public.sessions FOR ALL
  USING (auth.role() = 'service_role');

-- ─── Supabase Storage bucket ──────────────────────────────────────────────────
-- The 'resumes' bucket stores uploaded PDF files at path: {owner_id}/{resume_id}
-- Create via Supabase dashboard or CLI; cannot be created in SQL migrations.
-- Bucket name: resumes
-- Public: false
-- File size limit: 10 MB
-- Allowed MIME types: application/pdf

-- ─── Automatic updated_at via trigger ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_jobs_updated_at
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_resumes_updated_at
  BEFORE UPDATE ON public.resumes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_app_users_updated_at
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_telegram_chat_links_updated_at
  BEFORE UPDATE ON public.telegram_chat_links
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
