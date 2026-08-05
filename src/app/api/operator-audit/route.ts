// What operators have done. Operator-gated.
//
// Every lifecycle and portal action has been audit-logged since that work landed, and
// there was no way to read any of it without SQL. "Who opened this workspace and when"
// is the first question when an onboarding goes wrong.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireOperator } from '@/lib/operator-guard';
import { listOperatorAudit } from '@/lib/operator-audit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  enterTenant(await resolveTenant());
  const denied = await requireOperator();
  if (denied) return denied;
  try {
    return NextResponse.json({ entries: await listOperatorAudit(100) });
  } catch (err) {
    console.error('operator-audit error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
