-- Per-tenant custom skills in the Skill Library. tenant_id null = curated/global
-- (read-only to tenants, written by the HQ sync); tenant_id set = a workspace's own.
alter table public.skill_library add column if not exists tenant_id uuid;

drop policy if exists skill_library_read on public.skill_library;
create policy skill_library_read on public.skill_library for select
  using (tenant_id is null or tenant_id in (select public.current_user_tenant_ids()));
create policy skill_library_insert on public.skill_library for insert
  with check (tenant_id is not null and tenant_id in (select public.current_user_tenant_ids()));
create policy skill_library_update on public.skill_library for update
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
create policy skill_library_delete on public.skill_library for delete
  using (tenant_id in (select public.current_user_tenant_ids()));
