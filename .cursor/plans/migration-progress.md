# Migration Progress: Supabase Edge → Next.js API (Neon + Vercel Blob)

> Last updated: 2026-03-18
> Plan reference: `supabase_edge_→_next_api_(neon+blob)_0ddab6dc.plan.md`
> **Status: COMPLETE ✅** — All routes implemented, Supabase SDK removed, `supabase/` folder deleted, webhook script updated.

---

## Overall Status

| Phase                  | Status      | Done | Total |
| ---------------------- | ----------- | ---- | ----- |
| Server lib layer       | ✅ Complete | 12   | 12    |
| Auth routes            | ✅ Complete | 5    | 5     |
| Jobs CRUD routes       | ✅ Complete | 5    | 5     |
| Resume routes          | ✅ Complete | 3    | 3     |
| AI / JD tooling routes | ✅ Complete | 6    | 6     |
| External proxy route   | ✅ Complete | 1    | 1     |
| Telegram webhook route | ✅ Complete | 1    | 1     |
| Database schema        | ✅ Complete | —    | —     |
| Supabase SDK cleanup   | ✅ Complete | —    | —     |

**Routes total: 22 / 22 implemented**

---

## 1 · Server Lib Layer — `lib/server/`

| File              | Status  | Notes                                                                         |
| ----------------- | ------- | ----------------------------------------------------------------------------- |
| `neon.ts`         | ✅ Done | `getSql()` factory, `@neondatabase/serverless` connection pooling             |
| `auth.ts`         | ✅ Done | JWT sign/verify, cookie read/write, access + refresh token flow               |
| `otp.ts`          | ✅ Done | OTP hashing (SHA-256), rate-limit checks via `auth_rate_limits`, `email_otps` |
| `cors.ts`         | ✅ Done | Origin allowlist from `SITE_URL` env var                                      |
| `blob.ts`         | ✅ Done | `@vercel/blob` helpers: upload private PDF, stream download, delete           |
| `jobs.ts`         | ✅ Done | Full CRUD + paginated list + search + stats — all plain Neon SQL              |
| `resumes.ts`      | ✅ Done | List / get / create / update / delete — stores `blob_pathname`                |
| `openai-parse.ts` | ✅ Done | Port of `_shared/openai-parse.ts` — uses `process.env`, not `Deno.env`        |
| `telegram.ts`     | ✅ Done | Port of `_shared/telegram.ts` — uses `process.env.TELEGRAM_BOT_TOKEN`         |
| `telegram-db.ts`  | ✅ Done | Neon SQL port of Telegram DB helpers (chat links, challenges, sessions)       |
| `authz.ts`        | ✅ Done | API key validation helper                                                     |
| `validation.ts`   | ✅ Done | Input sanitisation helper                                                     |

---

## 2 · Route Handlers — `app/api/sfn/`

### Auth (5 / 5) ✅

| Route             | Method(s) | Contract                                                       |
| ----------------- | --------- | -------------------------------------------------------------- |
| `auth-send-otp`   | POST      | `{ email }` → `{ userId, expiresInMinutes }`                   |
| `auth-verify-otp` | POST      | `{ email, code }` → `{ id, email, name, token }` + set cookies |
| `auth-session`    | GET       | → `{ id, email, name }` or `{ …, token }` on refresh           |
| `auth-signout`    | POST      | → `{ success: true }` + clear cookies                          |
| `auth-status`     | GET       | → `{ authRequired: true }`                                     |

### Jobs CRUD (5 / 5) ✅

| Route         | Method(s)          | Notes                                    |
| ------------- | ------------------ | ---------------------------------------- |
| `jobs`        | GET, POST          | Paginated list; create                   |
| `jobs-by-id`  | GET, PATCH, DELETE | Single job                               |
| `jobs-search` | GET                | `?q=…&status=…` — trigram ILIKE via Neon |
| `jobs-stats`  | GET                | Total, this-week, per-status counts      |
| `jobs-bulk`   | GET, POST, DELETE  | Export / import / 410                    |

### Resumes (3 / 3) ✅

| Route          | Method(s)          | Notes                                              |
| -------------- | ------------------ | -------------------------------------------------- |
| `resumes`      | GET, POST          | List; multipart upload → Vercel Blob + Neon insert |
| `resume-by-id` | GET, PATCH, DELETE | DELETE removes blob then row                       |
| `resume-file`  | GET                | Auth check → `get(blobPathname)` → stream PDF      |

### AI / JD Tooling (6 / 6) ✅

| Route                 | Method | SSE | Model         | Notes                                                                |
| --------------------- | ------ | --- | ------------- | -------------------------------------------------------------------- |
| `jobs-parse`          | POST   | No  | gpt-4o-mini   | OpenAI parse JD → structured record + salary estimate, 50 s deadline |
| `jd-extract`          | POST   | No  | —             | Local heuristic extraction (no OpenAI call)                          |
| `cover-letter`        | POST   | Yes | gpt-4o-mini   | temp 0.35, max_tokens 700                                            |
| `missing-resume-gaps` | POST   | Yes | gpt-4o-mini   | temp 0.15, max_tokens 420                                            |
| `ats-resume`          | POST   | Yes | gpt-3.5-turbo | temp 0.5                                                             |
| `chat`                | POST   | Yes | gpt-4o        | Multi-turn, 15 k token guard, question-mode routing                  |

### External proxy (1 / 1) ✅

| Route           | Method | Notes                                                               |
| --------------- | ------ | ------------------------------------------------------------------- |
| `jobs-external` | GET    | Proxy to `jobs.indianapi.in`, 3 retries, 1.5 s exponential back-off |

### Telegram (1 / 1) ✅

| Route              | Method | Notes                                                                                                                                    |
| ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `telegram-webhook` | POST   | Secret check, OTP login, `/add`→JD parse→Neon insert, `/list`, `/search`, `/job`, `/status`, `/delete`, `/delete_bulk`, callback buttons |

### Fallback ✅

| Route            | Notes                                       |
| ---------------- | ------------------------------------------- |
| `[fn]` catch-all | Returns 404 — no longer proxies to Supabase |

---

## 3 · Database Schema — `scripts/init.sql`

| Check                                    | Status  | Detail                                                                                                                           |
| ---------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Supabase RLS removed                     | ✅ Done | All `ENABLE ROW LEVEL SECURITY` + all policies stripped                                                                          |
| `auth.uid()` / `auth.role()` removed     | ✅ Done | No Supabase auth functions remain                                                                                                |
| `resumes.blob_pathname` column           | ✅ Done | Present (nullable during back-fill)                                                                                              |
| `telegram_chat_links.session_expires_at` | ✅ Done | Present                                                                                                                          |
| Extensions (`pgcrypto`, `pg_trgm`)       | ✅ Done | Standard PostgreSQL — Neon compatible                                                                                            |
| ENUMs (`job_status`, `salary_period`)    | ✅ Done |                                                                                                                                  |
| All 8 tables                             | ✅ Done | `app_users`, `jobs`, `resumes`, `telegram_chat_links`, `telegram_login_challenges`, `sessions`, `email_otps`, `auth_rate_limits` |
| Indexes                                  | ✅ Done | Trigram, GIN full-text, composite sort, covering                                                                                 |
| `set_updated_at()` trigger               | ✅ Done | Applied to 5 tables                                                                                                              |

---

## 4 · Frontend / Client Layer

| File                          | Status     | Notes                                                                      |
| ----------------------------- | ---------- | -------------------------------------------------------------------------- |
| `lib/supabase-api.ts`         | ✅ Done    | `sfn()` helper returns `/api/sfn/<fn>` — no Supabase URLs                  |
| `lib/auth-client.ts`          | ✅ Done    | Uses `sfn()`, no direct Supabase imports                                   |
| `lib/storage.ts`              | ✅ Done    | Rewritten — all functions now call `/api/sfn/*` via fetch; no Supabase SDK |
| `lib/supabase-browser.ts`     | ✅ Deleted | Removed (was unused dead code)                                             |
| `lib/supabase-server-auth.ts` | ✅ Deleted | Removed (was unused dead code)                                             |

---

## 5 · Supabase Cleanup

| Item                                      | Status     | Notes                                                                                        |
| ----------------------------------------- | ---------- | -------------------------------------------------------------------------------------------- |
| `@supabase/supabase-js` in `package.json` | ✅ Removed | Deleted from dependencies                                                                    |
| `lib/supabase-browser.ts`                 | ✅ Deleted |                                                                                              |
| `lib/supabase-server-auth.ts`             | ✅ Deleted |                                                                                              |
| `lib/storage.ts` Supabase client          | ✅ Removed | Replaced with `fetch()` → API routes                                                         |
| `supabase/` folder                        | ✅ Deleted | Removed entirely — all edge functions superseded                                             |
| `scripts/set-telegram-webhook.mjs`        | ✅ Updated | Now reads `SITE_URL` (JSON-array aware) → `/api/sfn/telegram-webhook`; falls back to CLI arg |

---

## 6 · Environment Variables

| Variable                                       | Status      | Notes                                 |
| ---------------------------------------------- | ----------- | ------------------------------------- |
| `DATABASE_URL`                                 | ✅ Required | Neon connection string                |
| `APP_JWT_SECRET`                               | ✅ Required | JWT signing key                       |
| `SITE_URL`                                     | ✅ Required | JSON array of allowed origins         |
| `API_KEY`                                      | ✅ Required | Public API key for OTP-send endpoint  |
| `RESEND_API_KEY`                               | ✅ Required | OTP email delivery                    |
| `RESEND_FROM_EMAIL`                            | ✅ Required | From address for OTP emails           |
| `OPENAI_API_KEY`                               | ✅ Required | AI endpoints + salary estimation      |
| `BLOB_READ_WRITE_TOKEN`                        | ✅ Required | Vercel Blob (auto-injected on Vercel) |
| `TELEGRAM_BOT_TOKEN`                           | ✅ Required | Telegram bot                          |
| `TELEGRAM_WEBHOOK_SECRET`                      | ✅ Optional | Webhook secret validation             |
| `JOBS_API_KEY`                                 | ✅ Required | `jobs-external` → `jobs.indianapi.in` |
| `NEXT_PUBLIC_SUPABASE_URL`                     | 🗑️ Remove   | No longer needed                      |
| `SUPABASE_SERVICE_ROLE_KEY`                    | 🗑️ Remove   | No longer needed                      |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | 🗑️ Remove   | No longer needed                      |

---

## 7 · Remaining Cleanup

All automated cleanup is done. One manual step remains:

1. ~~**Delete `supabase/` folder**~~ ✅ Done
2. ~~**Update `scripts/set-telegram-webhook.mjs`**~~ ✅ Done
3. **Remove Supabase env vars** from Vercel project settings (manual): `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`

---

## 8 · Verification Checklist

- [ ] Auth: OTP send → verify → session → refresh → signout flow end-to-end
- [ ] Auth: Expired refresh token clears cookies correctly
- [ ] Jobs: Create, read paginated, search, stats, bulk export/import, delete
- [ ] Resumes: Upload PDF → stored in Vercel Blob → `blob_pathname` in Neon → stream download
- [ ] Resume delete: blob removed from Vercel Blob AND row deleted from Neon
- [ ] SSE endpoints: chunks arrive as `data: {"content":"…"}\n\n`, end with `data: [DONE]\n\n`
- [ ] `chat`: multi-turn history passed; 15 k token guard returns 429 when exceeded
- [ ] `jobs-external`: retries on 429 from external API, correct header forwarding
- [ ] Telegram: `/login`, OTP verify, `/add` (JD parse → Neon insert), `/list`, `/search`, `/status`, `/delete`, `/delete_bulk`, inline button callbacks
- [ ] CORS: preflight returns correct `Access-Control-Allow-Origin` for allowed origins
- [ ] No `@supabase/supabase-js` import anywhere in `app/` or `lib/` ✅
- [ ] `package.json` has no `@supabase/*` dependencies ✅
