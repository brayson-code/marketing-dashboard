-- 0051_salesops_playbook_phase2.sql — Playbook Studio Phase 2: the REANALYZE loop.
-- Additive only; mirrors the 0050/0049/0048/0047/0041 tenant-isolation + RLS pattern
-- EXACTLY. This migration does NOT alter salesops_config, salesops_playbooks, tenant
-- isolation, existing RLS, or any `WHERE tenant_id = ...` filter. (Write-only in this PR —
-- do NOT apply.)
--
-- Two new tenant-scoped tables that power "re-derive the active playbook from evidence":
--   salesops_playbook_sources — the EVIDENCE the analyzer reads. One row per source the rep
--     adds: a won call (sales_calls.id), a creator's Instagram (handle/URL, scraped via
--     Apify), a YouTube/manual paste (text stored as-is in Slice 1). The extracted text the
--     analyzer reads lives in `content`; `status` tracks extraction (pending→extracted|error).
--   salesops_playbook_changesets — the PROPOSED diff a Reanalyze run produced against the
--     current active playbook. NON-DESTRUCTIVE: a changeset never touches a playbook on its
--     own. Applying it (owner click) goes through the SAME non-destructive path as
--     playbook/apply — it INSERTs a NEW salesops_playbooks version + flips is_active +
--     mirrors into salesops_config; the changeset only records which new playbook it became
--     (applied_playbook_id) and flips its own status to 'applied'.
--
-- Both tables are pure provenance/staging: the ONE live source the token-authed
-- /api/salesops/suggest route reads stays salesops_config, exactly as in 0049/0050.

-- ── salesops_playbook_sources ─────────────────────────────────────────────────
create table if not exists public.salesops_playbook_sources (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  kind         text not null check (kind in ('won_call','instagram','youtube','manual')),
                 -- won_call: ref is a sales_calls.id (own closed-won call)
                 -- instagram: ref is a creator handle or a reel/post URL (Apify scrape)
                 -- youtube: ref is a video URL/handle (Slice 1: pasted text only)
                 -- manual: freeform pasted notes (no ref)
  label        text,                            -- rep-typed display label
  ref          text,                            -- sales_calls.id | handle/url | null (manual)
  niche        text,                            -- optional niche tag for grouping/context
  status       text not null default 'pending'
                 check (status in ('pending','extracted','error')),
  content      text,                            -- the extracted transcript/teardown/notes the analyzer reads
  metadata     jsonb not null default '{}'::jsonb,  -- extraction provenance (e.g. reel count, source urls)
  error        text,                            -- non-null when status='error' (extraction failure reason)
  created_by   uuid,                            -- workspace_members.user_id who added it
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists salesops_playbook_sources_tenant_idx
  on public.salesops_playbook_sources (tenant_id, created_at desc);

-- ── salesops_playbook_changesets ──────────────────────────────────────────────
create table if not exists public.salesops_playbook_changesets (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  base_playbook_id    uuid,                      -- the active salesops_playbooks row it was computed against
  status              text not null default 'pending'
                        check (status in ('pending','applied','discarded')),
  summary             text,                      -- one-line model summary of the proposed change-set
  changes             jsonb not null default '[]'::jsonb,  -- ChangeItem[] (see reanalyze.ts shape)
  sources_used        jsonb not null default '[]'::jsonb,  -- the salesops_playbook_sources.id[] fed to the run
  applied_playbook_id uuid,                      -- set on apply: the NEW salesops_playbooks row it became
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists salesops_playbook_changesets_tenant_idx
  on public.salesops_playbook_changesets (tenant_id, created_at desc);

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Identical uniform tenant-isolation policy as every other table (0002/0041/0047/0048/0049/
-- 0050 pattern). The backend connects as postgres (bypasses RLS) and still scopes every query
-- by tenant_id; this policy backstops the browser/anon path. The session-authed admin routes
-- run server-side under the postgres role after enterTenant(resolveTenant()) — they do NOT
-- rely on or weaken this policy.
alter table public.salesops_playbook_sources enable row level security;
drop policy if exists salesops_playbook_sources_rw on public.salesops_playbook_sources;
create policy salesops_playbook_sources_rw on public.salesops_playbook_sources for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

alter table public.salesops_playbook_changesets enable row level security;
drop policy if exists salesops_playbook_changesets_rw on public.salesops_playbook_changesets;
create policy salesops_playbook_changesets_rw on public.salesops_playbook_changesets for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
