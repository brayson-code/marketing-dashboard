-- 0013_reward_policy — Phase 3 (measurement loop) of the self-improving Command
-- Center (design: KB "Command Center PARL"). We SCORE completed agent runs with
-- the owner-weighted blend and accumulate per-(role, agent, variant) reward
-- stats. This slice MEASURES only — it does not yet change spawn decisions
-- (selection) — so it's risk-free. Scoring runs inside the existing improve cron.
--
-- reward_events: one scored row per agent_task (deduped). components holds the
-- blend inputs {approval, outcome, reliability} (any may be null = not available).
-- agent_policy: running reward stats the future bandit/selection will read.

create table if not exists public.reward_events (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  task_id     bigint,
  agent_id    text not null,
  role        text not null,
  reward      numeric not null,                 -- 0..1 blended
  components  jsonb not null default '{}'::jsonb, -- {approval, outcome, reliability}
  weights     jsonb not null default '{}'::jsonb,
  stage       text not null default 'cold',     -- cold | warm (curriculum)
  scored_at   timestamptz not null default now()
);
create index if not exists idx_reward_events_agent on public.reward_events(tenant_id, agent_id, scored_at desc);
create unique index if not exists uq_reward_events_task on public.reward_events(tenant_id, task_id) where task_id is not null;

create table if not exists public.agent_policy (
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  role         text not null,
  agent_id     text not null,
  variant      text not null default 'base',
  n            integer not null default 0,
  reward_sum   numeric not null default 0,
  reward_mean  numeric not null default 0,
  last_reward  numeric,
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, role, agent_id, variant)
);

alter table public.reward_events enable row level security;
alter table public.agent_policy  enable row level security;

drop policy if exists reward_events_rw on public.reward_events;
drop policy if exists agent_policy_rw  on public.agent_policy;

create policy reward_events_rw on public.reward_events for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create policy agent_policy_rw on public.agent_policy for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
