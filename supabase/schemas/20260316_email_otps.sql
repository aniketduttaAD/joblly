-- Email OTPs for custom auth
create table if not exists public.email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  salt text not null,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- simple rate limiting fields
  send_count integer not null default 1,
  window_start timestamptz not null default now(),
  blocked_until timestamptz
);

create index if not exists email_otps_email_idx
  on public.email_otps (email);

create unique index if not exists email_otps_email_unique_idx
  on public.email_otps (email);

create index if not exists email_otps_expires_at_idx
  on public.email_otps (expires_at);

create table if not exists public.auth_rate_limits (
  action text not null,
  scope text not null,
  scope_key text not null,
  attempts integer not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (action, scope, scope_key)
);

create index if not exists auth_rate_limits_blocked_until_idx
  on public.auth_rate_limits (blocked_until);
