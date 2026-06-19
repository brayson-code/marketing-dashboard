-- 0048_security_events.sql — append-only, tenant-scoped security/ops event stream.
-- Additive only, flag-independent. Mirrors the 0047/0002 tenant-isolation + RLS pattern
-- EXACTLY. This migration does NOT alter tenant isolation, existing RLS, or any
-- `WHERE tenant_id = ...` filter. (Write-only in this PR — do NOT apply yet.)
--
-- What it is: the ops-facing security event stream written by emitSecurityEvent()
-- (src/lib/security-events.ts). Best-effort, fire-and-forget; a write failure here
-- never blocks (or falsely allows) a request. Distinct from audit_log: audit_log is the
-- compliance/forensic trail, security_events is the high-signal operations stream the HQ
-- security console + alerts consume.
--
-- APPEND-ONLY by convention: the app only ever INSERTs and SELECTs. There is no UPDATE
-- or DELETE path in code. Rows are GC'd by retention policy later, not by handlers.

create table if not exists public.security_events (
  id            bigint generated always as identity primary key,
  tenant_id     uuid references public.tenants(id) on delete cascade,  -- NULL = system/anon event (e.g. anonymous auth_fail); HQ-console-only, excluded from tenant-scoped reads by RLS
  type          text not null,                  -- SecurityEventType (authz_deny, rate_limited, …)
  severity      text not null
                  check (severity in ('info','warning','critical')),
  actor_user_id uuid,                            -- workspace_members.user_id (auth uuid); null = system/anon
  resource_ref  text,                            -- provider key / route / target the event concerns
  detail        jsonb,                           -- JSON-serializable; NEVER a raw plaintext secret
  created_at    timestamptz not null default now()
);

-- Primary read pattern: a tenant's recent events, newest first.
create index if not exists idx_security_events_tenant_created
  on public.security_events (tenant_id, created_at desc);

-- Detections / grouping: a tenant's recent events of a given type, newest first.
create index if not exists idx_security_events_tenant_type_created
  on public.security_events (tenant_id, type, created_at desc);

-- RLS: identical uniform tenant-isolation policy as every other table (0002/0047 pattern).
-- The backend connects as postgres (bypasses RLS) and still scopes every query by
-- tenant_id; this policy backstops the browser/anon path. The ONE intentional
-- cross-tenant read (HQ security console) runs server-side under the postgres role and
-- is gated by requireHq() in application code — it does NOT rely on or weaken this policy.
alter table public.security_events enable row level security;
create policy security_events_tenant on public.security_events
  for all using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
