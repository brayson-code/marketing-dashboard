import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runImprovementSweep } from '@/lib/improve';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled auto-research / continuous-improvement sweep (Vercel Cron). Reviews
// the current state and files improvement proposals as drafts for review.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    try {
      const r = await runImprovementSweep();
      if (!r.ok) console.error('[cron:improve] error:', r.error);
      else console.log(`[cron:improve] ${r.proposals} proposal(s)`);
    } catch (err) {
      console.error('[cron:improve] unexpected:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'improve' }, { status: 202 });
}
