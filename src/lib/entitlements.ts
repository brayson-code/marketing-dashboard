// Plan entitlements — the single source of truth for "what is this workspace
// allowed to do?" Reads tenants.plan (already a text column) and answers via
// hasFeature / requireFeature / limit helpers.
//
// Today's lookup is sync because the active Autonomy/Plan only need cached info
// per request. When Stripe lands, the webhook writes the new plan to tenants.plan
// and this module needs ZERO changes — the catalog already maps plan → features.

import { sql, tenantId } from './db/client';
import type { Autonomy } from './autonomy';

export type Plan = 'free' | 'lite' | 'pro' | 'starter';

export interface PlanFeatures {
  /** Pages an agent owner can open. */
  pages: { boardroom: boolean; kg: boolean; genes: boolean };
  /** Autonomy modes the workspace is allowed to set. */
  autonomy: Autonomy[];
  /** Max simultaneous connected social accounts. Infinity = unlimited. */
  connections_max: number;
  /** Max enabled agents at one time. */
  agents_max: number;
  /** Display label + tier ranking (used by the upgrade card / badge). */
  label: string;
  rank: number;
}

// Two tiers users can be on, plus a legacy mapping for tenants created before
// pricing existed. `starter` is treated as Lite so existing workspaces inherit
// the right gating without a backfill migration.
export const PLAN_FEATURES: Record<Plan, PlanFeatures> = {
  free: {
    pages: { boardroom: false, kg: false, genes: false },
    autonomy: ['propose'],
    connections_max: 1,
    agents_max: 1,
    label: 'Free',
    rank: 0,
  },
  lite: {
    pages: { boardroom: false, kg: false, genes: false },
    autonomy: ['propose'],
    connections_max: 1,
    agents_max: 3,
    label: 'Lite',
    rank: 1,
  },
  starter: {
    // Legacy plan name — same shape as Lite. Webhook will rewrite to 'lite' on
    // first Stripe sync; until then we just treat it identically.
    pages: { boardroom: false, kg: false, genes: false },
    autonomy: ['propose'],
    connections_max: 1,
    agents_max: 3,
    label: 'Lite',
    rank: 1,
  },
  pro: {
    pages: { boardroom: true, kg: true, genes: true },
    autonomy: ['observe', 'propose', 'act_notify', 'full_auto'],
    connections_max: Infinity,
    agents_max: Infinity,
    label: 'Pro',
    rank: 2,
  },
};

const VALID_PLANS = new Set<Plan>(Object.keys(PLAN_FEATURES) as Plan[]);

/** Read the active tenant's plan. Defaults to `'lite'` for unknown values so we
 *  fail closed (never silently grant Pro features to a misconfigured row). */
export async function getPlan(): Promise<Plan> {
  try {
    const rows = (await sql()`
      SELECT plan FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ plan: string | null }>;
    const raw = (rows[0]?.plan ?? 'lite').toLowerCase();
    return VALID_PLANS.has(raw as Plan) ? (raw as Plan) : 'lite';
  } catch {
    return 'lite';
  }
}

/** Convenience: { plan, features } for the active tenant. */
export async function getEntitlements(): Promise<{ plan: Plan; features: PlanFeatures }> {
  const plan = await getPlan();
  return { plan, features: PLAN_FEATURES[plan] };
}

/** Highest-tier plan we currently sell — used by the "Upgrade to X" CTA. */
export function nextPaidPlan(current: Plan): Plan | null {
  const here = PLAN_FEATURES[current].rank;
  const above = Object.entries(PLAN_FEATURES)
    .map(([k, v]) => ({ plan: k as Plan, rank: v.rank }))
    .filter((p) => p.rank > here)
    .sort((a, b) => a.rank - b.rank);
  return above[0]?.plan ?? null;
}
