-- 0011_wave_runs
-- Phase 1 of the self-improving Command Center (see KB doc "Command Center PARL").
-- Parallel agent waves: a campaign runs N waves sequentially, each with 2-3
-- agents in parallel; each wave passes its *synthesis* (not raw data) forward.
-- A full campaign can't finish in one serverless invocation (300s cap) and would
-- thrash the ~5 req/min Anthropic cap, so we run ONE wave per invocation and
-- checkpoint here — the owner advances wave-by-wave (also controls cost).

create table if not exists public.wave_runs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  title        text not null,
  request      text,                              -- original plain-English request
  brief        jsonb not null default '{}'::jsonb, -- {objective, success, audience, constraints, risks[]}
  goal_id      text,                              -- linked /goals id (the verifiable outcome)
  waves        jsonb not null default '[]'::jsonb, -- WaveSpec[] plan: [{label, agents:[{agentId, task}]}]
  status       text not null default 'running',   -- running | done | error | cancelled
  current_wave integer not null default 0,        -- next wave index to run
  total_waves  integer not null default 0,
  final_report text,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_wave_runs_tenant on public.wave_runs(tenant_id, status, updated_at desc);

create table if not exists public.wave_step_runs (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  wave_run_id   uuid not null references public.wave_runs(id) on delete cascade,
  wave_index    integer not null,
  label         text,
  status        text not null default 'running',  -- running | done | error
  synthesis     text,
  agent_results jsonb,                             -- [{agentId, task, ok, text, error}]
  started_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index if not exists idx_wave_steps_run on public.wave_step_runs(tenant_id, wave_run_id, wave_index);

alter table public.wave_runs      enable row level security;
alter table public.wave_step_runs enable row level security;

drop policy if exists wave_runs_rw      on public.wave_runs;
drop policy if exists wave_step_runs_rw on public.wave_step_runs;

create policy wave_runs_rw on public.wave_runs for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy wave_step_runs_rw on public.wave_step_runs for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
