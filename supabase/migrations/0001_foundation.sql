-- 0001_foundation
-- Multi-tenant foundation for the KeyPlayers Command Center.
-- Establishes: extensions, the tenant model, an RLS helper, the documents
-- ("second brain") table, and Row-Level Security on all three.
-- Domain tables (content, leads, KG, drafts, etc.) are ported in later migrations.

-- ── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists pgcrypto;   -- gen_random_uuid()
create extension if not exists vector;     -- pgvector, for RAG embeddings (column added in RAG phase)

-- ── Tenancy core ────────────────────────────────────────────────────────────
create table public.tenants (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  plan       text not null default 'free',
  created_at timestamptz not null default now()
);

create table public.tenant_members (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null default 'owner' check (role in ('owner','admin','editor','viewer')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
create index idx_tenant_members_user on public.tenant_members(user_id);

-- Returns the tenant ids the current authenticated user belongs to.
-- SECURITY DEFINER so it bypasses RLS internally — this avoids infinite
-- recursion when tenant_members' own policy references membership.
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.tenant_members where user_id = auth.uid()
$$;

-- ── Documents: the "second brain" (/raw staging -> /wiki compiled) ───────────
create table public.documents (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  type       text not null default 'note',
  title      text not null,
  content    text not null default '',
  status     text not null default 'raw' check (status in ('raw','wiki','archived')),
  metadata   jsonb not null default '{}'::jsonb,
  version    integer not null default 1,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_documents_tenant  on public.documents(tenant_id);
create index idx_documents_status  on public.documents(tenant_id, status);

-- ── Row-Level Security ───────────────────────────────────────────────────────
alter table public.tenants        enable row level security;
alter table public.tenant_members enable row level security;
alter table public.documents      enable row level security;

create policy tenants_select on public.tenants
  for select using (id in (select public.current_user_tenant_ids()));

create policy members_select on public.tenant_members
  for select using (tenant_id in (select public.current_user_tenant_ids()));

create policy documents_all on public.documents
  for all
  using      (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
