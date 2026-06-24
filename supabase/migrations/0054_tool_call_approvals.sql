-- 0054_tool_call_approvals.sql — extend owner step-up approvals to cover orchestrator
-- tool calls (spawn_subagent / launch_campaign) under the OPT-IN TOOL_APPROVALS_ENABLED gate.
-- Additive only, flag-independent at the DB layer. (Write-only in this PR — do NOT apply yet.)
--
-- Today `pending_approvals.action` has NO column-level CHECK (0047 only CHECKs `status`),
-- so `action` already accepts any text and 'tool_call' rows would insert fine without this.
-- This migration adds a FORWARD-LOOKING CHECK that pins the allowed action set, KEEPING the
-- three existing values and ADDING 'tool_call'. It is conditional + idempotent: it drops any
-- pre-existing constraint of this name first, then re-creates it with the full value set.
-- No data rewrite, no behavior change for existing rotate/disconnect/clear rows.

alter table public.pending_approvals
  drop constraint if exists pending_approvals_action_check;

alter table public.pending_approvals
  add constraint pending_approvals_action_check
  check (action in ('rotate_secret', 'disconnect', 'clear', 'tool_call'));
