-- RLS reconciliation. current_user_tenant_ids() (used by every browser/anon-key RLS
-- policy + the Storage policies) resolved a user's tenants from the VESTIGIAL
-- tenant_members table. But the app's real membership lives in workspace_members,
-- and 0035 dropped the trigger that populated tenant_members — so a newly
-- provisioned client (who only has a workspace_members row) resolved to an EMPTY
-- tenant set and RLS denied all of their browser reads/writes (Storage uploads in
-- particular). UNION both tables so existing tenant_members rows AND the canonical
-- workspace_members rows resolve. SECURITY DEFINER + locked search_path retained.
create or replace function public.current_user_tenant_ids()
returns setof uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select tenant_id    from public.tenant_members    where user_id = auth.uid()
  union
  select workspace_id from public.workspace_members  where user_id = auth.uid()
$function$;
