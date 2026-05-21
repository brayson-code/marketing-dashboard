-- 0009_cron_jobs
-- Cloud cron board. The old OpenClaw cron read jobs.json + per-job log files off
-- a local disk — impossible on Vercel's read-only serverless FS. This stores the
-- jobs and their run history in Supabase instead. A Vercel Cron dispatcher
-- (/api/cron/dispatch) wakes hourly, runs any job whose next_run_at has passed,
-- spawns the configured KeyPlayer sub-agent, and records a cron_runs row.
--
-- Backend writes via the postgres role (bypasses RLS, filters tenant_id itself);
-- the RLS policies below guard the browser anon path. cron_templates already
-- exists (0002) and is reused as-is.

create table if not exists public.cron_jobs (
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  id               text not null,                 -- slug, unique per tenant
  name             text,
  agent_id         text,                          -- sub-agent type to spawn (research-analyst, content-writer, …)
  skill            text,
  enabled          boolean not null default true,
  schedule_expr    text not null default '0 9 * * *',  -- standard 5-field cron
  schedule_tz      text not null default 'UTC',
  payload          jsonb not null default '{}'::jsonb,  -- { message, … }
  delivery         jsonb not null default '{}'::jsonb,
  last_run_at      timestamptz,
  last_status      text,                          -- ok | error | running
  last_duration_ms integer,
  last_error       text,
  last_result      text,
  next_run_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index if not exists idx_cron_jobs_due on public.cron_jobs(tenant_id, enabled, next_run_at);

create table if not exists public.cron_runs (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  job_id       text not null,
  status       text not null,                     -- ok | error
  started_at   timestamptz not null default now(),
  duration_ms  integer,
  summary      text,
  error        text,
  task_id      bigint,                            -- links to agent_tasks.id
  next_run_at  timestamptz
);
create index if not exists idx_cron_runs_job on public.cron_runs(tenant_id, job_id, started_at desc);

alter table public.cron_jobs enable row level security;
alter table public.cron_runs enable row level security;

drop policy if exists cron_jobs_rw on public.cron_jobs;
drop policy if exists cron_runs_rw on public.cron_runs;

create policy cron_jobs_rw on public.cron_jobs for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy cron_runs_rw on public.cron_runs for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
