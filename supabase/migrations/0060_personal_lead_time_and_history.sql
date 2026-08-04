-- 0060_personal_lead_time_and_history — the two things that make Personal Life
-- actually useful to an Executive Assistant rather than just another list.
--
-- 1) LEAD TIME. A birthday on the 12th is not a task for the 12th — the gift has to be
--    chosen and ordered by the 5th. A trip in March needs flights booked in January.
--    Every personal-organiser tool stores the event date and reminds you ON the day,
--    which is exactly too late to act. `lead_days` gives each item an "act by" date
--    (due_at - lead_days), and the UI sorts and groups on THAT, not on the due date.
--    This is the difference between a calendar and an operating system.
--
-- 2) OCCURRENCE HISTORY. 0059 rolls a recurring item forward on completion, which loses
--    the record of what actually happened — so the fourth birthday in a row, nobody can
--    answer "what did we give her last year?". North Star §12 explicitly lists "Gift
--    history" for this reason. Each completion now writes an occurrence row, so history
--    accumulates: "2026 — Cartier bracelet, she loved it. 2025 — Napa weekend."
--    An assistant who can say that is the one a founder can't replace.

alter table public.personal_items
  add column if not exists lead_days integer not null default 0
    check (lead_days >= 0 and lead_days <= 365);

comment on column public.personal_items.lead_days is
  'Days BEFORE due_at that work must start. The "act by" date is due_at - lead_days.';

create table if not exists public.personal_item_log (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null,
  item_id     bigint not null references public.personal_items(id) on delete cascade,
  -- When this occurrence was completed (the birthday that passed, the trip that happened).
  occurred_at timestamptz not null default now(),
  -- What actually happened. The gift given, how it landed, where they stayed.
  note        text,
  created_at  timestamptz not null default now()
);

-- History is always read as "this item, newest first".
create index if not exists personal_item_log_item_idx
  on public.personal_item_log (tenant_id, item_id, occurred_at desc);

alter table public.personal_item_log enable row level security;
drop policy if exists personal_item_log_rw on public.personal_item_log;
create policy personal_item_log_rw on public.personal_item_log for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
