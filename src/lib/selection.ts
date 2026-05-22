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

const EXPLORE_EPS = 0.15; // 15% of the time, try a non-best variant to keep learning

interface VariantStat { variant: string; n: number; reward_mean: number }

async function variantsFor(role: string, agentId: string): Promise<VariantStat[]> {
  const rows = (await sql()`
    SELECT variant, n, reward_mean FROM public.agent_policy
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND role = ${role} AND agent_id = ${agentId}
  `) as unknown as Array<{ variant: string; n: number; reward_mean: string | number }>;
  return rows.map((r) => ({ variant: r.variant, n: r.n, reward_mean: Number(r.reward_mean) }));
}

/**
 * Pick a constraint variant for (role, agentId). Epsilon-greedy: usually the
 * highest mean-reward variant, occasionally a random other one to keep exploring.
 * Falls back to 'base' when there are 0–1 known variants (the current state).
 */
export async function chooseVariant(role: string, agentId: string): Promise<string> {
  let stats: VariantStat[];
  try {
    stats = await variantsFor(role, agentId);
  } catch {
    return 'base';
  }
  if (stats.length <= 1) return stats[0]?.variant ?? 'base';

  // Prefer variants with at least a little evidence; cold variants get explored.
  const best = stats.reduce((a, b) => (b.reward_mean > a.reward_mean ? b : a));
  if (Math.random() < EXPLORE_EPS) {
    const others = stats.filter((s) => s.variant !== best.variant);
    return others[Math.floor(Math.random() * others.length)]?.variant ?? best.variant;
  }
  return best.variant;
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
