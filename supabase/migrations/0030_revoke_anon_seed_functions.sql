-- These SECURITY DEFINER functions are trigger/seed helpers — fired by triggers
-- (as definer) or called by the backend (postgres role). They were also reachable
-- over PostgREST RPC by anon/authenticated. seed_org_chart(uuid) in particular let
-- an unauthenticated visitor seed an org chart into ANY tenant. Revoke public RPC
-- access; internal callers (triggers/postgres) are unaffected.
revoke execute on function public.seed_org_chart(uuid) from anon, authenticated;
revoke execute on function public.link_new_user_to_default_tenant() from anon, authenticated;
revoke execute on function public.on_new_tenant_seed() from anon, authenticated;
