-- 0050_salesops_playbooks.sql — Playbook Studio: named, versioned, split-testable sales
-- playbooks per tenant. Additive only; mirrors the 0049/0048/0047/0041 tenant-isolation +
-- RLS pattern EXACTLY. This migration does NOT alter salesops_config, tenant isolation,
-- existing RLS, or any `WHERE tenant_id = ...` filter. (Write-only in this PR — do NOT apply.)
--
-- Why this table (and not just more columns on salesops_config):
--   salesops_config stays the ONE live source the token-authed /api/salesops/suggest route
--   reads (loadConfig: persona/playbook/company_name/product_name/pricing/differentiators +
--   objection_keywords). Playbook Studio's "Apply" writes a NEW row here (history + variants
--   for split-testing) AND mirrors that row's structured fields into salesops_config, so the
--   co-pilot keeps working with ZERO changes to suggest/route.ts. Apply is NON-DESTRUCTIVE:
--   it only INSERTs here + flips is_active; prior playbooks are never updated/deleted.

create table if not exists public.salesops_playbooks (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  name         text not null,                  -- rep-named variant, e.g. "Consultative v2"
  content      jsonb not null default '{}'::jsonb,
                 -- the generated structured playbook (PlaybookContent): the human-readable
                 -- narrative + the fields it mirrors into salesops_config. Single source of
                 -- the snapshot, so a variant can be re-activated later byte-for-byte.
  inputs       jsonb not null default '{}'::jsonb,
                 -- PHASE 1: the wizard Q&A answers (PlaybookAnswers).
                 -- FUTURE: cited sources from won-calls / YouTube-IG teardown / niche
                 -- creators ({ answers, sources: [...] }) — additive, no column change needed.
  source       text not null default 'wizard',  -- 'wizard' | (future) 'reanalyze' | 'manual'
  is_active    boolean not null default false,  -- exactly one active per tenant (partial unique idx below)
  calls_count  integer not null default 0,      -- FUTURE split-test: calls that used this playbook
  won_count    integer not null default 0,      -- FUTURE split-test: closed-won among those
  created_by   uuid,                            -- workspace_members.user_id who applied it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists salesops_playbooks_tenant_idx
  on public.salesops_playbooks (tenant_id, created_at desc);

-- At most ONE active playbook per tenant (DB-enforced invariant the co-pilot relies on).
-- Apply flips is_active inside a transaction: clear the old active, then set the new one.
create unique index if not exists salesops_playbooks_one_active_idx
  on public.salesops_playbooks (tenant_id) where is_active;

-- FUTURE (Phase 2, noted — NOT built here): add salesops_config.active_playbook_id and
-- sales_calls.playbook_id so /suggest can read the active playbook directly and each call
-- records which variant it used → real per-variant close-rate split testing. calls_count /
-- won_count above are pre-added so that math needs no further migration.

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Identical uniform tenant-isolation policy as every other table (0002/0041/0047/0048/0049
-- pattern). The backend connects as postgres (bypasses RLS) and still scopes every query by
-- tenant_id; this policy backstops the browser/anon path. The session-authed admin routes run
-- server-side under the postgres role after enterTenant(resolveTenant()) — they do NOT rely on
-- or weaken this policy.
alter table public.salesops_playbooks enable row level security;
drop policy if exists salesops_playbooks_rw on public.salesops_playbooks;
create policy salesops_playbooks_rw on public.salesops_playbooks for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
