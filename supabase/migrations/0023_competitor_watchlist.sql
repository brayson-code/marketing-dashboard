-- Competitor watchlist + watched-reels storage (Competitor Intel).
-- A tenant tracks competitor handles (per platform) on a daily/weekly cadence; a
-- background checker pulls their recent reels into competitor_reels for transcribe
-- → analyze → script. Ad-hoc pastes (no watched competitor) land here too with a
-- NULL competitor_id. Additive only — revert with:
--   DROP TABLE competitor_reels; DROP TABLE competitors;

CREATE TABLE IF NOT EXISTS public.competitors (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  platform        text NOT NULL DEFAULT 'instagram',
  handle          text NOT NULL,
  display_name    text,
  enabled         boolean NOT NULL DEFAULT true,
  schedule        text NOT NULL DEFAULT 'daily',   -- 'daily' | 'weekly' | 'off'
  last_checked_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, handle)
);

CREATE TABLE IF NOT EXISTS public.competitor_reels (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  competitor_id   bigint REFERENCES public.competitors(id) ON DELETE SET NULL,  -- NULL = ad-hoc paste
  platform        text NOT NULL DEFAULT 'instagram',
  external_id     text,
  url             text NOT NULL,
  caption         text,
  views           bigint,
  likes           bigint,
  comments        bigint,
  posted_at       timestamptz,
  thumbnail_url   text,
  video_url       text,
  transcript      text,
  analysis        jsonb,
  script_draft_id bigint,
  status          text NOT NULL DEFAULT 'fetched',  -- fetched | transcribed | analyzed | scripted | error
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, platform, external_id)
);
CREATE INDEX IF NOT EXISTS idx_competitor_reels_competitor
  ON public.competitor_reels (tenant_id, competitor_id);
CREATE INDEX IF NOT EXISTS idx_competitor_reels_created
  ON public.competitor_reels (tenant_id, created_at DESC);
