import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runDueJobs } from '@/lib/cron-runner';
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
