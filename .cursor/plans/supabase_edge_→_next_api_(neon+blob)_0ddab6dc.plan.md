---
name: Supabase Edge → Next API (Neon+Blob)
overview: Migrate all functionality currently implemented in `supabase/functions/*` (auth, jobs, resumes, AI streaming endpoints, external jobs proxy, Telegram bot webhook) into Next.js App Router Route Handlers backed by Neon Postgres and Vercel Blob, preserving request/response shapes and cookie/JWT behavior so the existing frontend keeps working.
todos:
  - id: inventory-and-mapping
    content: "Write a definitive mapping doc: each `supabase/functions/<fn>` → new Next route handler path, methods, request/response contract, and required env vars."
    status: completed
  - id: neon-schema-plan
    content: Produce Neon-ready SQL schema derived from `scripts/init.sql` + OTP/rate-limit schema, removing Supabase-only RLS/auth constructs and adding resume blob fields.
    status: completed
  - id: blob-migration-plan
    content: "Design resume file migration to Vercel Blob (private): define blob pathnames; update resume rows; implement authenticated streaming download via `@vercel/blob` `get()`."
    status: completed
  - id: auth-port-plan
    content: "Port custom auth: OTP tables + rate limiting + JWT signing/verification + cookie policy, preserving names/TTL/headers."
    status: completed
  - id: endpoint-port-plan
    content: For each endpoint (jobs/resumes/AI/telegram/external), specify implementation details in Next (runtime choice, streaming, retries/timeouts) and corresponding Neon SQL queries.
    status: in_progress
  - id: cutover-and-cleanup
    content: "Plan cutover: delete all Supabase dependencies/config, keep only Next.js Route Handlers + Neon + Vercel Blob, and update Telegram webhook script."
    status: pending
isProject: false
---

## Inventory (what exists + what is actually used)

### Edge Functions (all are currently callable via `/api/sfn/[fn]` allowlist)

- **Auth**
  - `auth-send-otp`: POST; sends OTP via Resend; writes `email_otps` + `auth_rate_limits`.
  - `auth-verify-otp`: POST; validates OTP + rate limits; upserts/selects `app_users`; mints JWTs; sets cookies.
  - `auth-session`: GET; validates access JWT or refreshes via refresh cookie; returns user and sometimes `{ token }`.
  - `auth-signout`: POST; clears cookies.
  - `auth-status`: GET; returns `{ authRequired: true }`.
    - **Not referenced by app code** (only present in proxy allowlist + Supabase config).
- **Jobs CRUD**
  - `jobs`: GET paginated list; POST create.
  - `jobs-by-id`: GET by id; PATCH update; DELETE delete.
  - `jobs-search`: GET search by `q` and optional `status`.
  - `jobs-stats`: GET; computed stats.
  - `jobs-bulk`: GET export; POST import with duplicate detection; DELETE returns 410 (kept for backwards compat).
- **Resumes**
  - `resumes`: GET list; POST multipart upload (PDF) + OpenAI parse + store DB row.
  - `resume-by-id`: GET; PATCH metadata; DELETE (also deletes storage object).
  - `resume-file`: GET; streams stored PDF (currently from Supabase Storage; will migrate to Vercel Blob).
- **AI / JD tooling (streaming SSE except `jd-extract` and `jobs-parse`)**
  - `jobs-parse`: POST; OpenAI parse JD → returns parsed record.
  - `jd-extract`: POST; local heuristic extraction.
  - `cover-letter`: POST; **SSE** stream from OpenAI.
  - `missing-resume-gaps`: POST; **SSE** stream from OpenAI.
  - `ats-resume`: POST; **SSE** stream from OpenAI.
  - `chat`: POST; **SSE** stream from OpenAI (largest endpoint).
- **External API proxy**
  - `jobs-external`: GET; calls `https://jobs.indianapi.in/jobs` with `X-Jobs-Api-Key` and retries.
  - Used by frontend in `[app/job/search/lib/jobs-api.ts](/Volumes/mySpace/personal_projects/job application tracker/app/job/search/lib/jobs-api.ts)`.
- **Telegram bot**
  - `telegram-webhook`: POST; validates optional webhook secret; handles commands; uses DB tables `telegram_chat_links`, `telegram_login_challenges`, `sessions`; sends messages via Telegram HTTP API; uses Resend OTP flow.

### Shared modules and their usage

- `_shared/auth.ts`: **core** (JWT creation/verification; cookie parsing; user lookup in `app_users`; API allowlist logic for public auth endpoints).
- `_shared/otp.ts`: **core** (OTP hashing/verification, rate-limits via `auth_rate_limits`, `email_otps`).
- `_shared/db.ts`: **core** (jobs/resumes CRUD; Telegram tables; session table; note: currently builds `previewUrl` using a Supabase URL and deletes from Supabase Storage — both must be replaced).
- `_shared/cors.ts`: used by almost all endpoints (dynamic allowed origins).
- `_shared/openai-parse.ts`: used by `jobs-parse` and Telegram `/add` parsing; also does exchange-rate + salary estimation via OpenAI.
- `_shared/validation.ts`: used by jobs/resume-by-id.
- `_shared/telegram.ts`: used by `telegram-webhook`.

## Target architecture (100% Next.js + Neon + Vercel Blob, no Supabase)

### Non-negotiables for the migration

- **Only Next.js Route Handlers**: every endpoint becomes an App Router route under `app/api/...`.
- **Only Neon Postgres for DB**: access via `@neondatabase/serverless` (no Supabase client, no Supabase Auth).
- **Only Vercel Blob for file storage**: access via `@vercel/blob` (no Supabase Storage).
- **No additional SDKs**: use `fetch()` for OpenAI, Resend, and Telegram (do not use the `openai` npm package and do not use any Supabase SDKs).
- **Keep frontend contract stable**: keep paths as `/api/sfn/<fn>` so the existing `sfn()` helper continues working.

### Route layout (direct handlers, no proxy-to-Supabase)

- Implement each function as its own route file under `app/api/sfn/<fn>/route.ts`.
  - This removes the current “proxy to Supabase Edge Functions” behavior entirely.
  - Optional cleanup: once all explicit routes exist, delete `app/api/sfn/[fn]/route.ts` (or leave it as a hard 404 if you prefer).

### Minimal server-only code organization

- `lib/server/neon.ts`: creates a Neon SQL client using `@neondatabase/serverless`.
- `lib/server/auth.ts`: ports JWT + cookies from `supabase/functions/_shared/auth.ts` to Next (Node runtime recommended).
- `lib/server/otp.ts`: ports OTP hashing + rate limiting to Neon.
- `lib/server/cors.ts`: ports CORS origin allowlist logic to Next responses.
- `lib/server/blob.ts`: Vercel Blob helpers (upload/download/delete).
- `lib/server/jobs.ts`, `lib/server/resumes.ts`, `lib/server/telegram.ts`: DB queries (plain SQL) for each feature area.

### Route handler mapping (one-to-one, same contracts)

Implement these Next.js routes (direct, not a dispatcher calling Supabase):

- **auth-send-otp**: POST JSON `{ email }` → 200 `{ userId, expiresInMinutes }`.
- **auth-verify-otp**: POST JSON `{ email, code }` → 200 `{ id, email, name, token }` and set cookies.
- **auth-session**: GET → 200 `{ id, email, name }` OR `{ id, email, name, token }` when refreshed; clears cookies on invalid refresh.
- **auth-signout**: POST → 200 `{ success: true }` and clear cookies.
- **auth-status**: GET → 200 `{ authRequired: true }` (keep for compatibility even if unused).
- **jobs**: GET pagination; POST create.
- **jobs-by-id**: GET/PATCH/DELETE.
- **jobs-search**: GET.
- **jobs-stats**: GET.
- **jobs-bulk**: GET export; POST import; DELETE 410.
- **jobs-external**: GET passthrough to `jobs.indianapi.in` with retries; ensure header name handling matches.
- **jobs-parse**: POST; OpenAI parse + salary estimation (port `_shared/openai-parse.ts` but keep it as `fetch()` calls, not OpenAI SDK).
- **jd-extract**: POST local extraction.
- **resumes**: GET list; POST multipart upload:
  - parse PDF upload from `FormData`.
  - store PDF to Vercel Blob (`access:'private'`), e.g. pathname `resumes/<userId>/<resumeId>.pdf`.
  - parse resume text (OpenAI) if needed.
  - insert row into Neon `resumes` with `blob_pathname` (new column) and metadata.
- **resume-by-id**: GET/PATCH/DELETE:
  - DELETE: delete blob (`del(pathname)`) then delete row.
- **resume-file**: GET streams private blob:
  - verify user owns resume via Neon query.
  - `get(pathname, { access:'private' })` and return stream with PDF headers.
- **cover-letter / missing-resume-gaps / ats-resume / chat**: POST streaming SSE:
  - replicate current `ReadableStream` logic and headers (`text/event-stream`, `no-cache`, `keep-alive`).
- **telegram-webhook**: POST:
  - verify webhook secret (query param or header) same as current.
  - keep OTP login via Resend.
  - all DB operations moved to Neon.

## Neon DB migration (schema + data)

### Schema

- Start from `[scripts/init.sql](/Volumes/mySpace/personal_projects/job application tracker/scripts/init.sql)` plus `[supabase/schemas/20260316_email_otps.sql](/Volumes/mySpace/personal_projects/job application tracker/supabase/schemas/20260316_email_otps.sql)` **as a shape reference only**.
- **Neon-ready adjustments (required)**:
  - **Remove everything Supabase-only**: RLS enablement, policies using `auth.uid()` / `auth.role()`, and any Supabase auth assumptions.
  - Keep tables, indexes, triggers, enums.
  - Add Vercel Blob fields:
    - `resumes.blob_pathname text` (nullable during backfill; make `NOT NULL` after migration is complete).
    - Optional: `resumes.blob_url text` (store the returned `url`/`downloadUrl` if you want).
  - Ensure `telegram_chat_links` has `session_expires_at` (your runtime logic uses it).

### Data migration

- Export the existing Postgres data (from your current Supabase Postgres) for tables:
  - `app_users`, `jobs`, `resumes`, `email_otps`, `auth_rate_limits`, `telegram_chat_links`, `telegram_login_challenges`, `sessions`.
- Import to Neon.
- For resume PDFs:
  - Upload each existing resume file to Vercel Blob (private).
  - Backfill `resumes.blob_pathname` (and optional `resumes.blob_url`) in Neon.

## Vercel Blob migration (resumes)

- Store resumes as private blobs.
- Treat blobs as immutable; do not overwrite unless explicitly needed.
- Implement authenticated delivery via `resume-file` route using `get()` and stream to browser.

## Environment variables (Vercel + local)

- **Neon**: `DATABASE_URL` (Neon connection string).
- **Blob**: `BLOB_READ_WRITE_TOKEN` (or rely on Vercel auto-injection if same project).
- **Auth**: `APP_JWT_SECRET`.
- **Site/CORS**: `SITE_URL` JSON array string (same semantics as current).
- **Resend**: `RESEND_API_KEY`, `RESEND_FROM_EMAIL`.
- **OpenAI**: `OPENAI_API_KEY`.
- **Telegram**: `TELEGRAM_BOT_TOKEN`, optional `TELEGRAM_WEBHOOK_SECRET`.
- **Remove all Supabase env vars**: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ANON_KEY`, and any Supabase publishable keys (they should not be required after migration).

## App integration changes (minimal)

- Keep existing frontend `sfn()` helper in `[lib/supabase-api.ts](/Volumes/mySpace/personal_projects/job application tracker/lib/supabase-api.ts)` unchanged.
- Remove/replace Supabase storage client usage in `[lib/storage.ts](/Volumes/mySpace/personal_projects/job application tracker/lib/storage.ts)` with Blob-backed routes (recommended: for private blobs, the browser never talks directly to Blob; always go through your API routes).
- Update `scripts/set-telegram-webhook.mjs` to point to the new webhook URL (now `/api/sfn/telegram-webhook` on your deployed domain).

## Verification checklist (behavior parity)

- Auth cookies set/cleared correctly; refresh flow matches `lib/auth-client.ts` expectations.
- All jobs routes match existing JSON shapes and error codes.
- Resume upload/download works, including `previewUrl` returned in resume objects.
- SSE endpoints stream `data: {"content":...}` chunks and end with `data: [DONE]`.
- Telegram commands (`/login`, `/add`, `/list`, `/search`, callbacks) work end-to-end.
