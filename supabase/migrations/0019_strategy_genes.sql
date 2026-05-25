-- Strategy genes: compact, named, versioned, auditable "lessons" the self-improving
-- loop accumulates. Additive only — new tables, no changes to existing schema, so a
-- full revert is just DROP TABLE (see rollback at bottom).

CREATE TABLE IF NOT EXISTS public.strategy_genes (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  name        text NOT NULL,                 -- kebab slug, unique per tenant
  title       text NOT NULL,                 -- short human label
  body        text NOT NULL,                 -- the actual instruction injected into tasks
  role        text NOT NULL,                 -- applies to this agent role (matches roleFor())
  agent_id    text,                          -- null = whole role; else a specific agent
  status      text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','active','retired')),
  version     int  NOT NULL DEFAULT 1,
  tries       int  NOT NULL DEFAULT 0,
  wins        int  NOT NULL DEFAULT 0,
  reward_sum  double precision NOT NULL DEFAULT 0,
  reward_mean double precision NOT NULL DEFAULT 0,
  source      text,                          -- provenance (where it came from)
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);
CREATE INDEX IF NOT EXISTS idx_strategy_genes_lookup
  ON public.strategy_genes (tenant_id, role, status);

-- Audit trail: every birth/edit/approve/retire/application/reward is an event.
CREATE TABLE IF NOT EXISTS public.gene_events (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id  uuid NOT NULL,
  gene_id    bigint NOT NULL REFERENCES public.strategy_genes(id) ON DELETE CASCADE,
  kind       text NOT NULL,                  -- minted|proposed|approved|retired|edited|applied|rewarded
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_gene_events_gene
  ON public.gene_events (tenant_id, gene_id, created_at DESC);

-- Single-row global kill switch (instant on/off without a redeploy).
CREATE TABLE IF NOT EXISTS public.gene_config (
  tenant_id  uuid PRIMARY KEY,
  enabled    boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Full rollback (run to revert this migration entirely):
--   DROP TABLE IF EXISTS public.gene_events;
--   DROP TABLE IF EXISTS public.strategy_genes;
--   DROP TABLE IF EXISTS public.gene_config;
