-- 0056 — Document the agent_defs org-chart columns.
--
-- public.agent_defs.role_title / department / is_executive are already read and
-- written by app code (src/app/agents/squads/page.tsx via src/lib/squad.ts,
-- src/app/api/hero-agents/route.ts) and by public.seed_org_chart() (migration
-- 0037), but — like those functions — the columns themselves were added directly
-- to the live database out of band and were never captured in a migration. This
-- is `ADD COLUMN IF NOT EXISTS`: a no-op everywhere the columns already exist
-- (prod, and any TEST project that had them added the same out-of-band way), and
-- the one thing that makes a BRAND NEW database (e.g. a fresh TEST project
-- rebuilt from migrations alone) match what the app already assumes.
--
-- No behavior change; no data change to existing rows (is_executive defaults
-- false, matching every current non-C-suite agent_defs row).

alter table public.agent_defs
  add column if not exists role_title   text,
  add column if not exists department   text,
  add column if not exists is_executive boolean not null default false;
