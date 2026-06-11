-- Trial Reel Generator — fresh, testable short-form reel CONCEPTS the client
-- curates. The reel-ideator sub-agent turns live trends + competitor wins into a
-- batch of ideas (hook/angle/format) stored here; the client keeps or dismisses
-- them, then optionally turns a kept idea into a script draft. Additive only —
-- revert with:  DROP TABLE reel_ideas;

CREATE TABLE IF NOT EXISTS public.reel_ideas (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id       uuid NOT NULL,
  hook            text,
  angle           text,
  format          text,
  rationale       text,
  trend_tag       text,
  status          text NOT NULL DEFAULT 'proposed',  -- proposed | kept | dismissed
  script_draft_id bigint,
  batch_id        text,                               -- ideas from one generate() run share this
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_reel_ideas_created
  ON public.reel_ideas (tenant_id, created_at DESC);
