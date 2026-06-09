-- Per-tenant media asset library for the Hyperframes studio. Uploaded a-roll /
-- b-roll clips (and images) live in Vercel Blob; this table records the metadata
-- + public URL so the editor can list them and assign them as scene backgrounds
-- ("switch and mash clips"). No stock — only tenant uploads + AI-generated.
-- Additive only — revert with:  DROP TABLE tenant_assets;

CREATE TABLE IF NOT EXISTS public.tenant_assets (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  kind        text NOT NULL DEFAULT 'video',   -- video | image
  name        text,
  url         text NOT NULL,                    -- public Vercel Blob URL
  pathname    text,                             -- blob pathname (used for delete)
  size_bytes  bigint,
  duration_ms bigint,
  source      text NOT NULL DEFAULT 'upload',   -- upload | ai
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tenant_assets_created
  ON public.tenant_assets (tenant_id, created_at DESC);
