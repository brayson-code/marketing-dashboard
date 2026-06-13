import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { dispatchDueCadence } from '@/lib/cadence-dispatch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Vercel Cron — hourly automated cadence dispatcher. Sends owner-APPROVED sequence
// steps whose scheduled_for has passed, for tenants that opted in. Ships INERT:
// no-op unless env CADENCE_DISPATCH_ENABLED === 'true' AND the tenant has
// business_profile.cadence_enabled === true (see cadence-dispatch.ts).
//
// Gated by CRON_SECRET (the proxy leaves /api/cron/* public). Returns 202 fast and
// does the send pass in `after()` so the cron invocation isn't held open by sends.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    try {
      const r = await dispatchDueCadence();
      if (r.sent > 0 || (r.skipped ?? 0) > 0 || (r.failed ?? 0) > 0) {
        console.log('[cron:cadence] result:', r);
      }
    } catch (err) {
      console.error('[cron:cadence] unexpected:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'cadence' }, { status: 202 });
}
