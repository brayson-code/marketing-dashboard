-- Allow goals to be PAUSED (a reversible hold) in addition to abandoned.
-- Paused goals are excluded from the active-goals query agents work on, so the
-- squad stops working toward a paused goal until it's resumed.
alter table public.goals drop constraint if exists goals_status_check;
alter table public.goals add constraint goals_status_check
  check (status = any (array['active','pending_verification','done','abandoned','paused']));
