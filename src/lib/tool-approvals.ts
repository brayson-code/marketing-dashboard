// Tool-call approval gate — CONFIG ONLY (no DB, no executors, no orchestrator import).
//
// This module is the single source of truth for two things the orchestrator gate and the
// resolve path both need to agree on:
//   1. WHETHER gating is on at all  → toolApprovalsEnabled()  (OPT-IN, default OFF).
//   2. WHICH tools are gated        → GATED_TOOLS              (the orchestrator tools that
//                                      spend real resources: spawn a sub-agent / launch a
//                                      campaign). Anything not in this set behaves as today.
//
// HARD RULE (non-breaking, default-off): when TOOL_APPROVALS_ENABLED !== 'true', the
// orchestrator must run EXACTLY as it does today — no pending row, no new code path. The
// gate site wraps its behavior change in `toolApprovalsEnabled()`; nothing here has any
// effect unless that env flag is explicitly set to the literal string 'true'.
//
// Kept deliberately tiny and DEPENDENCY-FREE so it can be imported from either side
// (orchestrator gate OR pending-approvals resolve) with zero cycle risk.

/** The orchestrator tools that require owner step-up approval when gating is enabled. */
export const GATED_TOOLS = ['launch_campaign', 'spawn_subagent'] as const;

export type GatedTool = (typeof GATED_TOOLS)[number];

/**
 * OPT-IN flag check. True ONLY when the env var is the literal string 'true'.
 * Unset / any other value → false → ZERO gating (orchestrator behaves as today).
 * Read at call time (not module load) so it can't be frozen at import in tests.
 */
export function toolApprovalsEnabled(): boolean {
  return process.env.TOOL_APPROVALS_ENABLED === 'true';
}

/** Whether a given tool name is in the gated set (narrows to GatedTool). */
export function isGatedTool(name: string): name is GatedTool {
  return (GATED_TOOLS as readonly string[]).includes(name);
}
