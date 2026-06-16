-- Node-based generation canvas (Hyperframes "Canvas" mode). Stores the React Flow
-- graph (nodes/edges/viewport) per tenant, plus a per-node async generation job
-- table for AI image/video provider calls. RLS mirrors the standard tenant policy;
-- the backend postgres role bypasses it and scopes by tenantId() in app code.

create table if not exists public.generation_canvas (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  title       text not null default 'Untitled canvas',
  nodes       jsonb not null default '[]'::jsonb,
  edges       jsonb not null default '[]'::jsonb,
  viewport    jsonb,
  draft_id    bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists generation_canvas_tenant_idx on public.generation_canvas (tenant_id, updated_at desc);

alter table public.generation_canvas enable row level security;
drop policy if exists generation_canvas_rw on public.generation_canvas;
create policy generation_canvas_rw on public.generation_canvas for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));

create table if not exists public.generation_jobs (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  canvas_id   bigint,
  node_id     text,
  provider    text not null,           -- media-provider id, e.g. 'nanobanana' | 'veo'
  kind        text not null,           -- 'text-to-image' | 'image-to-video'
  status      text not null default 'queued',  -- queued | processing | completed | failed
  input       jsonb,
  output_url  text,
  external_id text,                     -- provider job/operation id (async)
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists generation_jobs_tenant_idx on public.generation_jobs (tenant_id, created_at desc);

alter table public.generation_jobs enable row level security;
drop policy if exists generation_jobs_rw on public.generation_jobs;
create policy generation_jobs_rw on public.generation_jobs for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
