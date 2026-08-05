-- 0062_workspace_lifecycle — separate PROVISIONING from ACCESS.
--
-- Today creating a workspace also creates the login: scripts/create-client.ts makes the
-- tenant, the auth user, the membership and the JWT claim in one shot. That is wrong for
-- how KeyPlayers actually sells. Client Success provisions on the onboarding call, but
-- the client has not fully paid yet and must not get in until day one.
--
-- ── THE SAFETY PROPERTY OF THIS MIGRATION ───────────────────────────────────
-- `status` DEFAULTS TO 'active'. Every one of the 14 existing production workspaces
-- becomes 'active' on apply, and any code path not explicitly changed keeps creating
-- active workspaces. This migration cannot lock anybody out — a workspace only becomes
-- dark when something deliberately asks for it.
--
-- ── HOW ACCESS IS ACTUALLY CONTROLLED ───────────────────────────────────────
-- Not by filtering requests. A 'provisioned' workspace has NO auth user and NO
-- workspace_members row, so there is nothing to log in with. Revoking access
-- (pause/offboard) removes the membership and clears the JWT tenant claim, which the
-- existing middleware already handles by sending the user to /no-workspace.
--
-- That means NO new per-request check and no new way for the request path to fail. This
-- column is the record of intent that Client Success works from; the auth rows are the
-- enforcement. Keeping those two aligned is the job of src/lib/workspace-lifecycle.ts.

alter table public.tenants
  add column if not exists status text not null default 'active'
    check (status in ('provisioned','active','paused','offboarded'));

-- When the workspace was stood up on the onboarding call, and by whom.
alter table public.tenants add column if not exists provisioned_at  timestamptz;
alter table public.tenants add column if not exists provisioned_by  text;

-- Day one. Set when the workspace is opened to the client.
alter table public.tenants add column if not exists activated_at    timestamptz;

-- The intended go-live date, agreed on the onboarding call. Lets Client Success see
-- what is due to open without holding it in their head.
alter table public.tenants add column if not exists go_live_on      date;

-- Why a workspace was paused or offboarded — so the next person to look knows.
alter table public.tenants add column if not exists status_note     text;

create index if not exists tenants_status_idx on public.tenants (status);

-- Backfill activated_at for everything that was already live, so the column reads
-- honestly rather than showing 14 workspaces that appear never to have been activated.
update public.tenants set activated_at = created_at
  where status = 'active' and activated_at is null;
