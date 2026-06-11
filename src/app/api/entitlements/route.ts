import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getEntitlements, PLAN_FEATURES, nextPaidPlan } from '@/lib/entitlements';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/entitlements → the current tenant's plan + features, plus the catalog
// so the UI never has to hardcode what each plan unlocks (a single source of
// truth makes the upgrade card and gate badges consistent everywhere).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const { plan, features } = await getEntitlements();
    return NextResponse.json({
      plan,
      features,
      next: nextPaidPlan(plan),
      catalog: PLAN_FEATURES,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
