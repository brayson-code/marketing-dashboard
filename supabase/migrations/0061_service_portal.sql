-- 0061_service_portal — the client's view of KeyPlayers as a service.
--
-- Everything else in the Command Centre is about the CLIENT'S business. This is the one
-- surface about the relationship: who your assistant is, when they work, what leave
-- they have, how to get help, how to ask for more people, and what's coming up.
--
-- Two shapes, because the content genuinely splits:
--
--   service_profiles      — PER TENANT. Who your assistant is and how they work.
--                           Written by HQ during onboarding; the client only reads it.
--
--   service_announcements — GLOBAL (no tenant_id). Published once by HQ, read by every
--                           workspace. Same posture as agent_library (0058) and
--                           skill_library (0044): a shared reference table, readable by
--                           any authenticated user, writable only by the service role.
--                           Olivia posts once; all 14 workspaces see it.
--
-- Leave ENTITLEMENTS and the holiday calendar deliberately do NOT live here — they are
-- contractual policy that is the same for everyone, so they live in
-- src/lib/service-policy.ts where they are versioned and reviewable. Only the facts
-- that vary per placement (start date, hours, timezone, region) are stored.

-- ── Per-tenant service profile ──────────────────────────────────────────────
create table if not exists public.service_profiles (
  tenant_id          uuid primary key references public.tenants(id) on delete cascade,

  -- The assistant
  ea_name            text,
  ea_role            text,                      -- what they own, in the client's words
  ea_started_on      date,                      -- START DATE WITH THIS CLIENT. Drives
                                                -- probation + accrual (per-client basis).
  ea_timezone        text,                      -- IANA, e.g. 'America/Toronto'
  ea_hours_start     text        not null default '09:00',
  ea_hours_end       text        not null default '17:00',
  ea_days            text[]      not null default '{mon,tue,wed,thu,fri}',

  -- Which national holiday calendar this placement follows.
  holiday_region     text        not null default 'CA' check (holiday_region in ('CA','US')),

  -- Who to talk to at KeyPlayers
  success_contact_name  text,
  success_contact_email text,

  plan_name          text,
  notes              text,                      -- anything specific to this placement

  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

alter table public.service_profiles enable row level security;
drop policy if exists service_profiles_read on public.service_profiles;
-- Read-only for the workspace. Writes come from HQ through the service/postgres role,
-- which bypasses RLS — a client must never be able to edit their own leave dates.
create policy service_profiles_read on public.service_profiles for select
  using (tenant_id in (select public.current_user_tenant_ids()));

-- ── Global announcements / events / trainings ───────────────────────────────
create table if not exists public.service_announcements (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null default 'announcement'
                 check (kind in ('announcement','event','training')),
  -- Olivia: different people publish for different audiences — internal team vs
  -- external VAs vs clients. EAs have no logins yet, so only 'client' and 'all' render
  -- today; the column is here so VA-facing posts don't need a migration later.
  audience     text not null default 'client'
                 check (audience in ('client','va','all')),
  title        text not null,
  body         text not null default '',
  -- Events/trainings only. Null for a plain announcement.
  starts_at    timestamptz,
  location     text,
  link         text,
  pinned       boolean not null default false,
  published_at timestamptz not null default now(),
  -- After this, it stops rendering. A stale "upcoming" event is worse than none.
  expires_at   timestamptz,
  created_by   text,
  created_at   timestamptz not null default now()
);

create index if not exists service_announcements_feed_idx
  on public.service_announcements (audience, published_at desc);
create index if not exists service_announcements_starts_idx
  on public.service_announcements (starts_at) where starts_at is not null;

alter table public.service_announcements enable row level security;
drop policy if exists service_announcements_read on public.service_announcements;
-- Global reference content: any authenticated user may read. No write policy, so under
-- RLS the anon/authenticated roles cannot write at all; the service role bypasses RLS.
create policy service_announcements_read on public.service_announcements for select
  using (true);
