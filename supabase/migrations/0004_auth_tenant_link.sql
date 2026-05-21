-- 0004_auth_tenant_link
-- V1 single-tenant convenience: when a new auth user is created (e.g. via the
-- Supabase dashboard or future signup), automatically link them to the KeyPlayers
-- tenant as 'owner'. Replace with a proper invite/onboarding flow for multi-tenant.

create or replace function public.link_new_user_to_default_tenant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.tenant_members (tenant_id, user_id, role)
  values ('fff35ccb-d1da-4fef-b8cb-e363fe1b8e14', new.id, 'owner')
  on conflict (tenant_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.link_new_user_to_default_tenant();
