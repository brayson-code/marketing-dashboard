-- 0064_leave_requests — the assistant asks, the client approves, KeyPlayers has a record.
--
-- The portal already computes what an assistant has accrued. Seeing a number you cannot
-- act on is only half a feature: today the actual request happens in a DM, the client
-- agrees in another DM, and nobody at KeyPlayers has a record of either. Olivia's team
-- finds out when someone does not turn up.
--
-- Deliberately NOT a balance ledger. The entitlement is computed from the start date
-- (src/lib/service-policy.ts) and what has been taken is the sum of approved rows, so
-- there is one source of truth for accrual and no running total to drift out of step
-- with it.

create table if not exists public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,

  -- Who asked. The assistant's auth user, plus their email captured at request time so
  -- the record still reads correctly after someone's placement ends.
  requester_id    uuid,
  requester_email text,

  kind         text not null check (kind in ('vacation','sick','emergency')),
  starts_on    date not null,
  ends_on      date not null,
  -- WORKING days, not calendar days — counted against the assistant's own working days
  -- at request time so a later schedule change cannot silently re-price old leave.
  days         numeric(4,1) not null check (days > 0),
  note         text,

  status       text not null default 'pending'
                 check (status in ('pending','approved','declined','cancelled')),
  -- Whether this was inside probation, captured at request time. Time taken in the
  -- first three months is unpaid and the client is credited, unless the assistant makes
  -- the hours up — so this has to be recorded, not recomputed later.
  unpaid       boolean not null default false,

  decided_by   text,
  decided_at   timestamptz,
  decision_note text,

  created_at   timestamptz not null default now(),

  constraint leave_dates_ordered check (ends_on >= starts_on)
);

create index if not exists leave_requests_tenant_idx
  on public.leave_requests (tenant_id, status, starts_on);

alter table public.leave_requests enable row level security;

-- Everyone in the workspace can SEE the workspace's leave: the client needs to approve
-- it, and the assistant needs to see their own. Writes go through the server (which
-- enforces who may request vs who may decide), so there is no write policy here.
drop policy if exists leave_requests_read on public.leave_requests;
create policy leave_requests_read on public.leave_requests for select
  using (tenant_id in (select public.current_user_tenant_ids()));
