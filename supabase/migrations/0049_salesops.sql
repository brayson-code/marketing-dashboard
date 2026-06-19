-- 0049_salesops.sql — SalesOps (PIF AI Sales Co-Pilot) re-host: token auth, per-tenant
-- config, and call records. Additive only, flag-independent (gated by SALESOPS_ENABLED in
-- app code). Mirrors the 0048/0047/0041 tenant-isolation + RLS pattern EXACTLY. This
-- migration does NOT alter tenant isolation, existing RLS, or any `WHERE tenant_id = ...`
-- filter. (Write-only in this PR — do NOT apply yet.)
--
-- Three tenant-scoped tables:
--   salesops_tokens — per-tenant bearer secrets the browser extension authenticates with.
--     Only the SHA-256 hash of the token is stored; the raw value is shown to the rep ONCE
--     at creation and never persisted. The extension runs on meet/zoom/teams/webex and can't
--     carry our Supabase session cookie, so these /api/salesops/* routes self-authenticate
--     with the bearer token (mirrors the webhook-secret model). resolveSalesopsToken() looks
--     the token_hash up GLOBALLY (it is unique across tenants), then enters that tenant.
--   salesops_config — one row per tenant: the rep-facing prompt context (persona/playbook/
--     company/product/pricing/differentiators), objection keywords, suggestion cadence, and
--     summary toggles. Read by the extension (token-authed GET) and written by the owner page
--     (session-authed admin route). Holds NO secrets.
--   sales_calls — one row per call: transcript, Claude CRM summary, parsed deal temperature,
--     and structured insights consumed by the KG / CRM pipeline.

-- ── salesops_tokens ───────────────────────────────────────────────────────────
create table if not exists public.salesops_tokens (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  token_hash   text not null,                 -- SHA-256 hex of the raw "sk_sops_…" token; raw never stored
  label        text,                          -- rep-typed label (e.g. "Jane's laptop")
  created_by   uuid,                          -- workspace_members.user_id who minted it
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,                   -- best-effort touch on each authenticated request
  revoked_at   timestamptz,                   -- non-null = dead; resolveSalesopsToken ignores it
  unique (token_hash)                         -- token_hash is globally unique → safe to look up outside tenant context
);
create index if not exists salesops_tokens_tenant_idx on public.salesops_tokens (tenant_id);

-- ── salesops_config ───────────────────────────────────────────────────────────
create table if not exists public.salesops_config (
  tenant_id              uuid primary key references public.tenants(id) on delete cascade,
  persona                text,
  playbook               text,
  company_name           text,
  product_name           text,
  pricing                text,
  differentiators        text,
  objection_keywords     jsonb not null default '[]'::jsonb,
  suggestion_interval_ms integer not null default 15000,
  summary_enabled        boolean not null default false,
  summary_fields         jsonb not null default '["deal_temp","objections","pain_points","next_steps","action_items"]'::jsonb,
  updated_at             timestamptz not null default now()
);

-- ── sales_calls ───────────────────────────────────────────────────────────────
create table if not exists public.sales_calls (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  client_call_id    text,                      -- the extension's stable per-call id; correlates all /suggest turns + /summary to ONE row (upsert key)
  created_by        uuid,                      -- salesops_tokens.created_by (the rep on the call)
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  platform          text,                      -- 'meet' | 'zoom' | 'teams' | 'webex' | null (from page host)
  contact_name      text,                      -- optional, rep-typed
  contact_email     text,                      -- optional → links to a lead
  lead_id           text references public.leads(id),  -- set by the pipeline if matched/created
  transcript        text,                      -- full final transcript
  summary           text,                      -- raw CRM summary text from /summary
  deal_temp         text check (deal_temp in ('HOT','WARM','COLD')),  -- parsed from summary
  suggestions_count integer not null default 0,
  metadata          jsonb,                     -- {objections:[], pain_points:[], next_steps:[], action_items:[]}
  created_at        timestamptz not null default now()
);
create index if not exists sales_calls_tenant_started_idx
  on public.sales_calls (tenant_id, started_at desc);
-- One row per (tenant, client_call_id) so the pipeline can upsert all turns + the
-- summary of a single call onto ONE row. NULL client_call_id (no-id fallback) is
-- exempt (Postgres treats NULLs as distinct), so those still get a fresh row each.
create unique index if not exists sales_calls_client_call_idx
  on public.sales_calls (tenant_id, client_call_id) where client_call_id is not null;

-- ── RLS ───────────────────────────────────────────────────────────────────────
-- Identical uniform tenant-isolation policy as every other table (0002/0041/0047/0048
-- pattern). The backend connects as postgres (bypasses RLS) and still scopes every query
-- by tenant_id; this policy backstops the browser/anon path. The /api/salesops/* routes
-- run server-side under the postgres role after resolveSalesopsToken() enters the token's
-- tenant — they do NOT rely on or weaken this policy.
alter table public.salesops_tokens enable row level security;
drop policy if exists salesops_tokens_rw on public.salesops_tokens;
create policy salesops_tokens_rw on public.salesops_tokens for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

alter table public.salesops_config enable row level security;
drop policy if exists salesops_config_rw on public.salesops_config;
create policy salesops_config_rw on public.salesops_config for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

alter table public.sales_calls enable row level security;
drop policy if exists sales_calls_rw on public.sales_calls;
create policy sales_calls_rw on public.sales_calls for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
