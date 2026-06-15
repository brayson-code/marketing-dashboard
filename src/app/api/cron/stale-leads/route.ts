import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { sweepStaleLeads } from '@/lib/stale-lead-sweep';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300;

// Daily Vercel Cron — stale-lead sweep. Finds leads who replied to us and
// haven't received a response, then drafts a reply via the outreach-sender
// sub-agent for owner approval. NEVER sends anything autonomously.
//
// Ships INERT: no-op unless env STALE_LEAD_SWEEP_ENABLED === 'true' AND the
// tenant has business_profile.stale_lead_sweep_enabled === true (see stale-lead-sweep.ts).
//
// CRON_SECRET-gated (the proxy leaves /api/cron/* public). Returns 202 fast;
// the actual sweep runs in after() so the cron invocation isn't held open.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;

  after(async () => {
    try {
      const r = await sweepStaleLeads();
      if (r.disabled) {
        console.log('[cron:stale-leads] disabled (env or no opted-in tenants)');
        return;
      }
      console.log(`[cron:stale-leads] tenants=${r.tenants} drafted=${r.drafted} skipped=${r.skipped}`);
    } catch (err) {
      console.error('[cron:stale-leads] unexpected:', (err as Error).message);
    }
  });

  return NextResponse.json({ ok: true, dispatched: 'stale-leads' }, { status: 202 });
}
