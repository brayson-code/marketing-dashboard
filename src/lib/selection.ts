// Phase 3 — the SELECTION seam (slice 3, behavior-preserving rail).
// Given a role + agent, choose which constraint VARIANT to use, biased toward the
// best-performing one in agent_policy, with a little exploration. Today only the
// 'base' variant exists, so this returns 'base' — but the rail is laid so that
// once constraint-variant evolution (slice 4a) creates alternatives, the
// orchestrator/spawn path can call chooseVariant() and the system will start
// preferring what works. Exploration is safe by construction: nothing an agent
// produces is sent without owner approval (the approval gate doubles as the
// safety net), so trying a variant only ever yields a draft to review.

import { sql, DEFAULT_TENANT_ID } from './db/client';
import { variantNames, type AgentRole } from './constraints';

const EXPLORE_EPS = 0.15; // 15% of the time, try a non-best variant to keep learning
const MIN_TRIES = 3;      // a variant is "explored" once it has this many runs
const PROBE_PROB = 0.5;   // when unexplored variants exist, probe one this often

interface VariantStat { variant: string; n: number; reward_mean: number }

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]; }

async function variantsFor(role: string, agentId: string): Promise<VariantStat[]> {
  const rows = (await sql()`
    SELECT variant, n, reward_mean FROM public.agent_policy
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND role = ${role} AND agent_id = ${agentId}
  `) as unknown as Array<{ variant: string; n: number; reward_mean: string | number }>;
  return rows.map((r) => ({ variant: r.variant, n: r.n, reward_mean: Number(r.reward_mean) }));
}

/**
 * Pick a constraint variant for (role, agentId). Considers all variants DEFINED
 * for the role (not just ones already scored), so freshly-added variants get
 * explored. Probes under-tried variants first, then epsilon-greedy on mean
 * reward. Returns 'base' for roles with a single variant (the common case).
 */
export async function chooseVariant(role: string, agentId: string): Promise<string> {
  const defined = variantNames(role as AgentRole);
  if (defined.length <= 1) return defined[0] ?? 'base';

  let stats: VariantStat[];
  try {
    stats = await variantsFor(role, agentId);
  } catch {
    return 'base';
  }
  const byVariant = new Map(stats.map((s) => [s.variant, s]));
  const tries = (v: string) => byVariant.get(v)?.n ?? 0;
  const mean = (v: string) => byVariant.get(v)?.reward_mean ?? 0;

  // 1) Probe under-tried variants to gather evidence.
  const unexplored = defined.filter((v) => tries(v) < MIN_TRIES);
  if (unexplored.length > 0 && Math.random() < PROBE_PROB) return pick(unexplored);

  // 2) Otherwise epsilon-greedy on mean reward (unknown variants => mean 0).
  if (Math.random() < EXPLORE_EPS) return pick(defined);
  return defined.reduce((best, v) => (mean(v) > mean(best) ? v : best), defined[0]);
}

/** Read the current policy for a role (for diagnostics / a future Learning view). */
export async function policyForRole(role: string): Promise<VariantStat[]> {
  const rows = (await sql()`
    SELECT variant, n, reward_mean FROM public.agent_policy
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND role = ${role}
    ORDER BY reward_mean DESC
  `) as unknown as Array<{ variant: string; n: number; reward_mean: string | number }>;
  return rows.map((r) => ({ variant: r.variant, n: r.n, reward_mean: Number(r.reward_mean) }));
}
