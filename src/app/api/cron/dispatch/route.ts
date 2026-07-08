import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runDueJobs, reapStuckRunningJobs } from '@/lib/cron-runner';
import { sweepStuckMissions } from '@/lib/waves';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Vercel Cron dispatcher (hourly). Runs every enabled job whose next_run_at has
// passed. Sub-hour schedules effectively fire at the top of the next hour, which
// is the cadence Vercel triggers this endpoint (see vercel.json crons).
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    // Self-heal FIRST: reset any job wedged in 'running' (a prior run killed by the
    // time cap) so the board doesn't show it frozen forever, and its rescheduled
    // next_run_at is respected by the due-scan below.
    try {
      const reap = await reapStuckRunningJobs();
      if (reap.reaped > 0) console.log(`[cron:dispatch] reaped ${reap.reaped} stuck job(s)`);
    } catch (err) {
      console.error('[cron:dispatch] stuck-job reap failed:', (err as Error).message);
    }
    try {
      const r = await runDueJobs();
      if (r.ran > 0) console.log(`[cron:dispatch] ran ${r.ran} job(s):`, r.results);
    } catch (err) {
      console.error('[cron:dispatch] unexpected:', (err as Error).message);
    }
    // Self-heal: re-kick or terminalize missions whose wave chain stalled, so a
    // dead background run doesn't sit as 'running' forever (recovery for the
    // pre-fix orphans + a safety net for any future orphan-kill).
    try {
      const s = await sweepStuckMissions();
      if (s.rekicked || s.failed) console.log(`[cron:dispatch] mission sweep: rekicked=${s.rekicked} failed=${s.failed}`);
    } catch (err) {
      console.error('[cron:dispatch] mission sweep failed:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'cron' }, { status: 202 });
}
