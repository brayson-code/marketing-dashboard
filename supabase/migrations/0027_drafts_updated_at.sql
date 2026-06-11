-- Script Studio editing: drafts can now be edited (payload/title) after creation.
-- Track when a draft was last modified so the UI can show "edited just now".
ALTER TABLE public.agent_drafts
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;
