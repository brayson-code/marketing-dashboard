-- 0047_abac_pending_approvals.sql — ABAC support: subject-attrs grants + owner step-up approvals.
-- Additive only, flag-independent (lands in Phase 0). All new columns/tables default
-- NULL/empty, so existing rows and single-owner flows behave EXACTLY as today. This
-- migration does NOT alter tenant isolation, RLS for existing tables, or any
-- `WHERE tenant_id = ...` filter. (Write-only in this PR — do NOT apply yet.)

-- (a) Optional per-member capability grants for ABAC subject.attrs.
--     workspace_members.preferences (0034) already exists and IS the UI-prefs store;
--     we add a DEDICATED `grants` jsonb so authz attributes don't collide with UI prefs.
--     getSubject() merges both into subject.attrs ({ ...preferences, ...grants }).
--     Zero rows have it set today → no behavior change.
alter table public.workspace_members
  add column if not exists grants jsonb not null default '{}'::jsonb;

-- (b) Owner step-up approvals (the SPECIAL case: secret/key rotation or disconnect
--     requested by a non-owner VA/member). The route inserts a pending row INSTEAD of
--     executing; the owner approves it in-app and the rotation runs server-side.
--     NOTE: payload must NEVER store a raw plaintext secret. Store the ENCRYPTED blob
--     (via encryptSecret()) or a server-held reference; the owner-approve endpoint
--     re-runs upsertIntegration()/disconnect() under the same tenant scope.
create table if not exists public.pending_approvals (
  id            bigint generated always as identity primary key,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  requested_by  uuid not null,                 -- workspace_members.user_id (auth uuid)
  action        text not null,                 -- e.g. 'rotate_secret','disconnect'
  resource_ref  text not null,                 -- e.g. provider key 'anthropic'
  payload       jsonb,                          -- the would-be mutation (NO plaintext secret — see note above)
  status        text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz,
  resolved_by   uuid
);

create index if not exists idx_pending_approvals_tenant
  on public.pending_approvals (tenant_id, status, created_at);

-- RLS: identical uniform tenant-isolation policy as every other table (0002 pattern).
-- The backend connects as postgres (bypasses RLS) and still scopes every query by
-- tenant_id; this policy backstops the browser/anon path.
alter table public.pending_approvals enable row level security;
create policy pending_approvals_tenant on public.pending_approvals
  for all using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

-- Deliberately NOT added here:
--  * author_user_id ownership columns — no Phase-0/1/2 consumer (ownership policies are
--    NULL-tolerant); defer until author-scoping is actually built (ADR §6, F-decision #5).
--  * tenant_members resurrection — workspace_members is canonical (0036); a second role
--    axis would re-create the admin/editor/viewer vs owner/member/va collision.
--  * audit_log.actor_id already exists (0002, uuid nullable) — no migration needed; only
--    the audit.ts code change populates it.
