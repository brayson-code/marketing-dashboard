-- 0058_agent_library — the UNIFIED, GLOBAL agent catalog.
--
-- WHY: today a full command center is provisioned by copying every agent_defs
-- row from the HQ tenant (fff35ccb…) into the new tenant. That makes HQ's
-- per-tenant agent_defs the de-facto "master library", but it is (a) tenant-
-- scoped data, not a catalog, and (b) limited to the ~27 rich agents that were
-- hand-seeded onto HQ. It is NOT a place Claude can browse/pick from at
-- provisioning time, and it does not hold the 110 niche-specific custom agents
-- authored in keycommand-provisioning/config/niche-config.json.
--
-- This table is that catalog: ONE global (tenant-agnostic) row per reusable
-- agent DEFINITION, populated from every authored source (bundled agents/**
-- rich souls + the 5 C-suite execs + the niche custom agents + the universal
-- defaults). Provisioning + the sales console read from here to decide which
-- agents a given command center gets; the chosen rows are then materialized as
-- agent_defs rows for the new tenant (that copy step is unchanged — see
-- src/lib/agent-library.ts for the read API this migration backs).
--
-- Global, like skill_library (0044): read by every authenticated user (it's a
-- shared reference catalog, not tenant data); writes go through the service role
-- (the seed script / HQ sync), never the browser.

create table if not exists public.agent_library (
  id             text primary key,                 -- deterministic slug, e.g. 'research-analyst' or 'niche-pi-instant-intake-responder'
  name           text not null,
  category       text not null default 'general',  -- coarse grouping: research|content|outreach|sales|scheduling|comms|client|quality|knowledge|leadership|orchestration|general
  role           text not null default 'general',  -- maps to agent_defs.role: research|content|outreach|scheduler|creative|general|orchestrator
  department     text,                             -- org-chart grouping (leadership|marketing|operations|revenue|client_experience), null for specialists
  is_executive   boolean not null default false,   -- C-suite vs specialist (mirrors agent_defs.is_executive)
  does           text not null default '',         -- one-line "what it does" (the pick signal shown to Claude at provisioning)
  soul           text not null default '',         -- prompt block 1 (identity/voice) — empty for 'thin' rows
  agent_md       text not null default '',         -- prompt block 2 (behavior/output) — empty for 'thin' rows
  skills         text not null default '',         -- prompt block 3 (playbooks) — empty for 'thin' rows
  default_niches text[] not null default '{}',     -- industry slugs that PRE-SELECT this agent at provisioning (e.g. {personal_injury_law})
  tags           text[] not null default '{}',     -- free-form facets (archetype, niche, source) for search/filtering
  richness       text not null default 'thin' check (richness in ('thin','rich')),
  source         text not null default 'authored', -- provenance: bundled | exec | niche | default | authored
  created_at     timestamptz not null default now()
);

-- Index the two hot filters: category (sales-console grouping) and the niche
-- membership check (agentsForNiche). default_niches is a text[] → GIN so
-- `default_niches @> ARRAY[$1]` / `&& ARRAY[$1]` stay index-backed.
create index if not exists agent_library_category_idx on public.agent_library (category);
create index if not exists agent_library_default_niches_idx on public.agent_library using gin (default_niches);
create index if not exists agent_library_tags_idx on public.agent_library using gin (tags);

-- Global reference catalog: any authenticated user may READ it (same posture as
-- public.skill_library, 0044). Writes are service-role only (the seed loader /
-- HQ sync), so there is NO write policy — under RLS, absence of a permissive
-- write policy means the anon/authenticated roles cannot INSERT/UPDATE/DELETE,
-- while the postgres/service role bypasses RLS entirely.
alter table public.agent_library enable row level security;
drop policy if exists agent_library_read on public.agent_library;
create policy agent_library_read on public.agent_library for select using (true);
