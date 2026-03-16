-- Harden email OTP auth by preventing duplicate OTP rows and storing
-- lightweight rate-limiter state for email/IP-based controls.

delete from public.email_otps e
using (
  select id
  from (
    select
      id,
      row_number() over (partition by email order by created_at desc, id desc) as rn
    from public.email_otps
  ) ranked
  where ranked.rn > 1
) stale
where e.id = stale.id;

create unique index if not exists email_otps_email_unique_idx
  on public.email_otps (email);

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

drop trigger if exists set_auth_rate_limits_updated_at on public.auth_rate_limits;
create trigger set_auth_rate_limits_updated_at
  before update on public.auth_rate_limits
  for each row execute function public.set_updated_at();
