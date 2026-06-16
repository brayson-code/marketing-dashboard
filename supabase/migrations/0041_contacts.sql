-- Saved contacts — a simple phone→name label per tenant. Used by the Engagement
-- SMS inbox to (a) start a brand-new conversation to a typed number and (b) show
-- a saved name instead of the raw number. RLS mirrors the standard tenant policy;
-- the backend postgres role bypasses it and scopes by tenantId() in app code.

create table if not exists public.contacts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  phone text not null,
  name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);
create index if not exists contacts_tenant_idx on public.contacts (tenant_id);

alter table public.contacts enable row level security;
drop policy if exists contacts_rw on public.contacts;
create policy contacts_rw on public.contacts for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
