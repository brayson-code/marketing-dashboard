-- 0003_goals_memory
-- Moves the two remaining filesystem-backed stores into Postgres so the agent
-- works on a read-only serverless host (Vercel):
--   goals (+ goal_progress)  <- was state/keyplayer/goals.md
--   agent_memory             <- was state/keyplayer/memory.md (compactor rollups)

create table public.goals (
  id text primary key,                 -- app-generated, e.g. g-2026-05-19-abc123
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  title text not null,
  success text not null,               -- verifiable success criterion
  due date,
  status text not null default 'active' check (status in ('active','pending_verification','done','abandoned')),
  evidence text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_goals_tenant_status on public.goals(tenant_id, status);

create table public.goal_progress (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  goal_id text not null references public.goals(id) on delete cascade,
  note text not null,
  created_at timestamptz not null default now()
);
create index idx_goal_progress_goal on public.goal_progress(goal_id);

create table public.agent_memory (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  rollup text not null,
  created_at timestamptz not null default now()
);
create index idx_agent_memory_tenant on public.agent_memory(tenant_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['goals','goal_progress','agent_memory'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for all using (tenant_id in (select public.current_user_tenant_ids())) with check (tenant_id in (select public.current_user_tenant_ids()))$p$, t || '_tenant', t);
  end loop;
end $$;
