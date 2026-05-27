-- Multi-tenant foundation. workspaces.id IS the tenant_id used everywhere else, so
-- existing data maps cleanly. Backend uses the postgres role (bypasses RLS), so true
-- isolation = every query scoping to tenantId(); RLS here is defense-in-depth for any
-- browser/anon path. Additive only.

CREATE TABLE IF NOT EXISTS public.workspaces (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  onboarding_complete boolean NOT NULL DEFAULT false,
  business_profile    jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  role         text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','member','va')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON public.workspace_members (user_id);

CREATE TABLE IF NOT EXISTS public.connections (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id           uuid NOT NULL,
  provider            text NOT NULL,
  provider_config_key text,
  connection_id       text,
  status              text NOT NULL DEFAULT 'connected',
  metadata            jsonb,
  connected_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_connections_tenant ON public.connections (tenant_id);

INSERT INTO public.workspaces (id, name, onboarding_complete)
VALUES ('fff35ccb-d1da-4fef-b8cb-e363fe1b8e14', 'KeyPlayers HQ', true)
ON CONFLICT (id) DO NOTHING;
