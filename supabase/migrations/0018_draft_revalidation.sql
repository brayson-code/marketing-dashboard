-- Draft re-validation ("is this still needed?") — mirrors 0012_issue_revalidation.
-- Stores the triage verdict back onto the draft; never executes anything.
ALTER TABLE public.agent_drafts
  ADD COLUMN IF NOT EXISTS revalidated_at timestamptz,
  ADD COLUMN IF NOT EXISTS revalidation jsonb;

-- Partial index to quickly find open drafts that have never been triaged.
CREATE INDEX IF NOT EXISTS idx_agent_drafts_untriaged
  ON public.agent_drafts (tenant_id, created_at)
  WHERE status IN ('pending','approved') AND revalidated_at IS NULL;
