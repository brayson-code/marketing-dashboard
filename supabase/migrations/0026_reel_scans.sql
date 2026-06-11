-- Reel Optimizer — the owner's OWN short-form reel, deeply scanned (Content Lab
-- "Optimize my reel"). A scan scrapes + transcribes the reel, pulls real IG
-- insights when the account is connected, then spawns reel-optimizer to score it,
-- find timestamped weak points, and write goal-tailored rewrites. One row per scan.
-- Additive only — revert with:  DROP TABLE reel_scans;

CREATE TABLE IF NOT EXISTS public.reel_scans (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  url             text NOT NULL,
  goal            text NOT NULL DEFAULT 'general',  -- views | retention | sales | engagement | general
  status          text NOT NULL DEFAULT 'scanning', -- scanning | done | error
  had_transcript  boolean DEFAULT false,
  thumbnail_url   text,
  transcript      text,
  scores          jsonb,
  report          jsonb,
  error           text,
  created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reel_scans_created
  ON public.reel_scans (tenant_id, created_at DESC);
