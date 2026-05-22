import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runTriageSweep } from '@/lib/triage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled triage sweep (Vercel Cron). Re-validates a bounded batch of open drafts
// + open issues against the current state of the world and flags stale ones for the
// owner's explicit dismiss/keep. Never dismisses or executes anything itself.
// after() keeps the function alive until the (slow, model-bound) sweep finishes.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    try {
      const r = await runTriageSweep();
      if (r.error) console.error('[cron:triage] error:', r.error);
      else console.log(`[cron:triage] checked ${r.ran}, flagged ${r.flagged}`);
    } catch (err) {
      console.error('[cron:triage] unexpected:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'triage' }, { status: 202 });
}
