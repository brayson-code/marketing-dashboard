-- Stop auto-attaching every new auth user to the HQ tenant.
--
-- on_auth_user_created fired link_new_user_to_default_tenant() on every new
-- auth.users row, inserting it into tenant_members for the HQ tenant
-- (fff35ccb-…) as 'owner'. That table is VESTIGIAL — the app resolves the tenant
-- from the JWT app_metadata.tenant_id claim and reads workspace_members for
-- membership; nothing reads tenant_members — so the trigger only created a
-- misleading "everyone belongs to HQ" attachment and is a footgun as we open up
-- signups. Invite-only provisioning (POST /api/clients) now gives each client
-- their OWN tenant + workspace_members owner row + JWT claim explicitly, and
-- resolveTenant fails closed (no claim → no-workspace, never HQ). Drop both.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.link_new_user_to_default_tenant();
