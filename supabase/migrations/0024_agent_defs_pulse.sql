-- agent_defs.pulse — the per-agent rolling "pulse" state written by setAgentPulse()
-- and read by getDefPrompt()/getAgentPulse() and the agent detail page. The column
-- was added out-of-band to the live DB during the pulse/heartbeat work but never
-- captured as a migration, so a fresh DB (local/CI/new project) would be missing it
-- and every getDefPrompt() would throw, silently disabling Agent Studio prompt edits
-- system-wide. IF NOT EXISTS makes this a no-op where the column already exists.
-- Revert: ALTER TABLE public.agent_defs DROP COLUMN IF EXISTS pulse;

ALTER TABLE public.agent_defs ADD COLUMN IF NOT EXISTS pulse text;
