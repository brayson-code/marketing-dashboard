-- Per-USER UI preferences (multi-tenant). workspace_members is the per-user,
-- per-tenant join row, so it's the natural home for state that must be distinct
-- between teammates sharing one workspace (unlike tenants.onboarding_complete,
-- which is shared). First consumer: the setup walkthrough — { walkthrough_disabled,
-- celebrated }. Backend connects as postgres (bypasses RLS); RLS on this table
-- (migration 0029) already scopes browser access to the member's own workspaces.
alter table public.workspace_members
  add column if not exists preferences jsonb not null default '{}'::jsonb;
