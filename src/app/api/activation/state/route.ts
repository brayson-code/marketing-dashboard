import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getActivationState } from '@/lib/activation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/activation/state
// Returns the 72-hour activation clock + the 5-milestone checklist. The UI
// (QuickWinCountdown on Overview) polls this every 20s so a freshly-approved
// draft flips the row from pending to done with no manual refresh.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json(await getActivationState());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
