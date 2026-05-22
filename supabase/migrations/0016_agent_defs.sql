-- 0016_agent_defs — Agent Studio. Move agent definitions (the soul/agent/skills
-- prompts + model/budget/role) into the DB so the owner can view/edit/create
-- agents LIVE from the Workspace (no redeploy), and so KeyPlayer can eventually
-- author its own specialists. The bundled agents/** files remain the fallback
-- (and the seed source); DB rows win when present.

create table if not exists public.agent_defs (
  tenant_id      uuid not null references public.tenants(id) on delete cascade,
  id             text not null,                 -- agent type slug, e.g. 'research-analyst'
  name           text not null,
  role           text not null default 'general', -- research|content|outreach|scheduler|creative|general|orchestrator
  model          text not null default 'claude-sonnet-4-6',
  max_tokens     integer not null default 4096,
  rate_per_hour  integer not null default 30,
  description    text not null default '',
  soul           text not null default '',
  agent_md       text not null default '',
  skills         text not null default '',
  spawnable      boolean not null default true, -- false for the orchestrator (keyplayer)
  enabled        boolean not null default true,
  source         text not null default 'custom', -- builtin | custom
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  primary key (tenant_id, id)
);

alter table public.agent_defs enable row level security;
drop policy if exists agent_defs_rw on public.agent_defs;
create policy agent_defs_rw on public.agent_defs for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
