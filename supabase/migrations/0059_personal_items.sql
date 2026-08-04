-- 0059_personal_items — the Personal Life section of the Command Centre.
--
-- WHY: North Star §12 lists "Personal Life Operations" as one of the six sections an
-- Executive Assistant works out of (travel, reservations, gifts, birthdays, family
-- logistics, purchases, health reminders, events, household). None of it existed — the
-- CRM is a sales pipeline, not the founder's personal life, and tasks are company work.
-- This table is the founder's personal side, kept deliberately separate from company
-- data so an EA can answer "what's coming up in their life?" without wading through work.
--
-- ONE table, not five: travel/dates/family/health/errands are the same shape (a thing,
-- for a person, on a date, with notes) and differ only in category. Five tables would
-- mean five API routes and five list UIs for no gain.
--
-- RLS mirrors the standard tenant policy (see 0041_contacts); the backend postgres role
-- bypasses it and scopes by tenantId() in app code.

create table if not exists public.personal_items (
  id           bigint generated always as identity primary key,
  tenant_id    uuid not null,
  category     text not null check (category in ('travel','dates','family','health','errands')),
  title        text not null,
  details      text,
  -- Who it concerns (partner, child, parent, the founder themselves). Free text: an EA
  -- shouldn't have to create a contact record before noting a birthday.
  person       text,
  -- When it happens / is due. Nullable: "research a gift for Olivia" has no fixed date.
  due_at       timestamptz,
  -- Recurring life events (birthdays, anniversaries, annual checkups). 'none' is the
  -- common case; the others roll the due date forward when completed.
  recurrence   text not null default 'none' check (recurrence in ('none','weekly','monthly','yearly')),
  status       text not null default 'open' check (status in ('open','done')),
  -- How much it matters — drives ordering and the "needs attention" grouping.
  priority     text not null default 'normal' check (priority in ('low','normal','high')),
  completed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- The list view is always "this tenant, this category, soonest first".
create index if not exists personal_items_tenant_idx
  on public.personal_items (tenant_id, category, due_at);
-- The overview/"what's coming up" query is "this tenant, still open, soonest first".
create index if not exists personal_items_open_idx
  on public.personal_items (tenant_id, status, due_at)
  where status = 'open';

alter table public.personal_items enable row level security;
drop policy if exists personal_items_rw on public.personal_items;
create policy personal_items_rw on public.personal_items for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
