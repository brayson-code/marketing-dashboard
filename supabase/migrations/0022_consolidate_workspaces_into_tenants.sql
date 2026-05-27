-- A "workspace" IS a tenant. 35 tables already FK tenant_id → tenants, so new
-- client data REQUIRES a tenants row. Consolidate: add onboarding fields to tenants,
-- point membership at tenants, drop the redundant workspaces table from 0021.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS onboarding_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS business_profile jsonb;

UPDATE public.tenants SET onboarding_complete = true
WHERE id = 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';

ALTER TABLE public.workspace_members DROP CONSTRAINT IF EXISTS workspace_members_workspace_id_fkey;
ALTER TABLE public.workspace_members
  ADD CONSTRAINT workspace_members_workspace_id_fkey
  FOREIGN KEY (workspace_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

DROP TABLE IF EXISTS public.workspaces;
