-- Movie-clip search cache (PlayPhrase). The PlayPhrase catalogue is PUBLIC and
-- shared, so the cache is GLOBAL (not tenant-scoped): a phrase is searched via a
-- headless browser at most once across the whole platform, then served instantly
-- from here. Imported clips still land per-tenant in tenant_assets.
create table if not exists public.movie_clip_cache (
  id          bigint generated always as identity primary key,
  -- normalized search key: lower(trim(phrase)), single-spaced
  phrase      text not null unique,
  -- array of clip objects: { id, text, movie, video_url, duration_ms, words, content_safety }
  clips       jsonb not null default '[]'::jsonb,
  hit_count   integer not null default 1,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists movie_clip_cache_updated_idx on public.movie_clip_cache (updated_at desc);

-- RLS on (defense in depth). The cache holds no tenant data and is written only
-- by the server (the postgres role bypasses RLS); authenticated users may read it.
-- No anon access.
alter table public.movie_clip_cache enable row level security;

drop policy if exists movie_clip_cache_read on public.movie_clip_cache;
create policy movie_clip_cache_read on public.movie_clip_cache
  for select to authenticated using (true);
