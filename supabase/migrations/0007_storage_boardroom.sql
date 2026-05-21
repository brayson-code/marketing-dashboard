-- 0007_storage_boardroom
-- A private Storage bucket for boardroom uploads (pasted/dropped screenshots &
-- files the owner shares with the orchestrator). Objects are namespaced by
-- tenant_id as the first path segment: "{tenant_id}/{uuid}-{filename}".
--
-- RLS: authenticated members of a tenant may read/write only that tenant's
-- folder. The backend orchestrator reads images via short-lived signed URLs
-- (created by the authenticated browser/server at upload time), so it never
-- needs the service-role key.

insert into storage.buckets (id, name, public)
values ('boardroom-uploads', 'boardroom-uploads', false)
on conflict (id) do nothing;

-- Helper: the first folder of an object path, as a uuid (the tenant_id).
-- (storage.foldername(name))[1] is the leading path segment.

drop policy if exists "boardroom uploads: tenant read"   on storage.objects;
drop policy if exists "boardroom uploads: tenant insert"  on storage.objects;
drop policy if exists "boardroom uploads: tenant update"  on storage.objects;
drop policy if exists "boardroom uploads: tenant delete"  on storage.objects;

create policy "boardroom uploads: tenant read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'boardroom-uploads'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_user_tenant_ids() t
    )
  );

create policy "boardroom uploads: tenant insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'boardroom-uploads'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_user_tenant_ids() t
    )
  );

create policy "boardroom uploads: tenant update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'boardroom-uploads'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_user_tenant_ids() t
    )
  );

create policy "boardroom uploads: tenant delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'boardroom-uploads'
    and (storage.foldername(name))[1] in (
      select t::text from public.current_user_tenant_ids() t
    )
  );
