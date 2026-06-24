-- 0053_wave_stop_when — declarative early-halt controls for the PARL waves loop.
--
-- Additive + inert by default. Both columns are nullable; when BOTH are null the
-- mission behaves EXACTLY as before (run every wave, then finalize). No RLS change,
-- no tenant-isolation change, no existing-filter change. (Write-only in this PR —
-- do NOT apply.)
--
--   max_waves  — optional integer cap on how many waves to run. When set, the loop
--                finalizes (status='done') after wave index (max_waves - 1) instead
--                of running the full plan. null = run all waves (today's behavior).
--
--   stop_when  — optional declarative halt condition, evaluated at each wave boundary
--                AFTER that wave's synthesis is produced and BEFORE advancing. Shape:
--                  { "condition": "goal_met" | "no_progress", "note"?: string }
--                  - goal_met:    halt once the linked goal (wave_runs.goal_id → goals.id)
--                                 is satisfied/closed (goals.status in 'done' | 'abandoned').
--                  - no_progress: halt when a wave's synthesis is empty or a near-duplicate
--                                 of the previous wave's synthesis (the loop has stopped
--                                 learning — no reason to keep spending).
--                  - note:        optional free-text reason recorded into the final report.
--                null = no condition (today's behavior). Halting still goes through the
--                existing finalize() + the existing 'done' status — no new status value.

alter table public.wave_runs add column if not exists max_waves integer;
alter table public.wave_runs add column if not exists stop_when jsonb;

comment on column public.wave_runs.max_waves is
  'Optional cap on waves to run before finalizing. null = run all waves (default).';
comment on column public.wave_runs.stop_when is
  'Optional early-halt condition evaluated at each wave boundary. Shape: '
  '{ "condition": "goal_met" | "no_progress", "note"?: string }. null = no condition (default). '
  'goal_met halts when the linked goal is closed; no_progress halts on an empty/near-duplicate '
  'synthesis. Halting reuses finalize() + status=''done'' (no new status value).';
