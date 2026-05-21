import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runDueJobs } from '@/lib/cron-runner';

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
  });
  return NextResponse.json({ ok: true, dispatched: 'cron' }, { status: 202 });
}
