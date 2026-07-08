-- 0057_cron_display_order
-- BUG: toggling a cron job on/off (or "Run now") visibly reshuffled the /cron board.
-- Root cause: listCronJobs() ordered by `created_at ASC` with NO tiebreaker. The 5
-- seeded C-suite exec crons (on_new_tenant_seed_cron, see 0037) are bulk-inserted via
-- a single `INSERT ... SELECT`, so all 5 rows share the EXACT same created_at
-- (now() is evaluated once per statement). Postgres does not guarantee a stable row
-- order for ties, and an UPDATE (toggleCronJob flips enabled + next_run_at) writes a
-- new physical tuple (MVCC) — so those tied rows can come back in a different order
-- on the very next read. This is what looked like "moves up/down the list".
--
-- FIX: a persisted, user-draggable display_order column. The list query now orders
-- by display_order first (with created_at + id as deterministic fallback tiebreakers
-- for any row that hasn't been manually placed yet), so enabling/disabling/triggering
-- a job — which only ever touches enabled/next_run_at/last_* — can never move it.
--
-- NOTE: file only. Do NOT run this against any project from here — the coordinator
-- applies it (TEST project first, then prod) after review.

alter table public.cron_jobs
  add column if not exists display_order integer;

-- Backfill: give every existing row a stable order per tenant, oldest first. `id` is
-- the tiebreaker for the exact-duplicate created_at rows described above, so the
-- backfill itself is deterministic even though the pre-fix reads weren't.
with ordered as (
  select
    tenant_id,
    id,
    row_number() over (partition by tenant_id order by created_at asc, id asc) as rn
  from public.cron_jobs
  where display_order is null
)
update public.cron_jobs c
set display_order = ordered.rn
from ordered
where c.tenant_id = ordered.tenant_id
  and c.id = ordered.id;

-- Supports `ORDER BY tenant_id, display_order` (list query) without a full sort.
create index if not exists idx_cron_jobs_display_order
  on public.cron_jobs (tenant_id, display_order);
