-- 0008_observability (KeyWatch)
-- Real-time bug auditing: raw error_events are deduped (by fingerprint) into
-- issues. An issue is the Linear-style "card" the owner triages and a Fixer
-- sub-agent gets assigned to. Backend writes via the postgres role (bypasses
-- RLS, so it filters tenant_id itself); RLS below guards the browser anon path.

create table if not exists public.issues (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  fingerprint  text not null,
  title        text not null,
  level        text not null default 'error',   -- error | warning | fatal
  source       text not null default 'server',  -- client | server | edge
  status       text not null default 'triage',  -- triage | assigned | fix_proposed | in_review | resolved | ignored
  priority     text not null default 'med',     -- low | med | high | urgent
  count        integer not null default 1,
  route        text,
  sample_message text,
  sample_stack   text,
  root_cause     text,
  suggested_fix  text,
  pr_url         text,
  assignee       text,
  task_id        bigint,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (tenant_id, fingerprint)
);
create index if not exists idx_issues_tenant_status on public.issues(tenant_id, status, last_seen desc);

create table if not exists public.error_events (
  id          bigserial primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  issue_id    uuid references public.issues(id) on delete cascade,
  level       text not null default 'error',
  source      text not null default 'server',
  message     text not null,
  stack       text,
  component_stack text,
  url         text,
  route       text,
  method      text,
  user_agent  text,
  release     text,
  context     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists idx_error_events_issue  on public.error_events(issue_id, created_at desc);
create index if not exists idx_error_events_tenant on public.error_events(tenant_id, created_at desc);

alter table public.issues       enable row level security;
alter table public.error_events enable row level security;

drop policy if exists issues_rw       on public.issues;
drop policy if exists error_events_rw on public.error_events;

create policy issues_rw on public.issues for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy error_events_rw on public.error_events for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
