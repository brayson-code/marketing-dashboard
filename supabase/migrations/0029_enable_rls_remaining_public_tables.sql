-- Enable RLS + tenant-scoped policies on public tables that were exposed to
-- PostgREST (anon/authenticated) without any row filter — a cross-tenant leak.
--
-- The backend connects as the postgres (owner) role, which BYPASSES RLS, so this
-- is non-breaking for the app; it only constrains the browser-facing anon key.
-- Mirrors the existing agent_defs_rw policy: a row is visible iff its tenant is
-- one of the caller's tenants (current_user_tenant_ids() is SECURITY DEFINER and
-- reads workspace_members as owner, so it does not recurse through these policies).

do $$
declare t text;
begin
  foreach t in array array[
    'strategy_genes','gene_events','gene_config','key_audit','time_savings_log',
    'connections','competitors','competitor_reels','reel_ideas','reel_scans','tenant_assets'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format(
      'create policy %I on public.%I for all using (tenant_id in (select public.current_user_tenant_ids())) with check (tenant_id in (select public.current_user_tenant_ids()))',
      t || '_rw', t
    );
  end loop;
end $$;

-- workspace_members has no tenant_id; it maps user_id -> workspace_id (= tenant).
alter table public.workspace_members enable row level security;
drop policy if exists workspace_members_rw on public.workspace_members;
create policy workspace_members_rw on public.workspace_members for all
  using (workspace_id in (select public.current_user_tenant_ids()))
  with check (workspace_id in (select public.current_user_tenant_ids()));
