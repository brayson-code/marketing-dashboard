// Thin plan-gate helper — a pure module so it can be unit-tested without any
// database or Next.js context. Import getEntitlements() from entitlements.ts
// when you need the full server-side plan lookup.
//
// HQ rule: the system-default (HQ) tenant always passes every gate. This lets
// the platform operator access Pro features regardless of the row value in the
// tenants table (which may be 'lite' for legacy rows or seeded defaults).

import { DEFAULT_TENANT_ID } from './tenant';
import type { Plan } from './entitlements';

/** Plans that get access to the Knowledge Graph. */
const KG_ALLOWED_PLANS = new Set<Plan>(['pro']);

/**
 * Returns true when the given tenant/plan combination should have access to the
 * Knowledge Graph (and /api/kg endpoints). HQ tenant always passes.
 *
 * Treats any unknown plan value conservatively: locked (false), EXCEPT for HQ.
 */
export function planAllowsKg(plan: string, tid: string): boolean {
  // HQ always wins — the platform operator must never be locked out.
  if (tid === DEFAULT_TENANT_ID) return true;
  return KG_ALLOWED_PLANS.has(plan as Plan);
}
