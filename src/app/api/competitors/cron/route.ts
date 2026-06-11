import { NextResponse, after } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId, currentUserId, runWithTenant } from '@/lib/tenant';
import { runWatchlistDue } from '@/lib/reel-intel';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // walks due competitors, scrapes + analyzes in the background

// Manual per-tenant "run my watchlist now" trigger (runs under the caller's
// tenant). POST only — a GET would let a browser prefetch/link-scan kick off an
// expensive scrape+analyze sweep. The SCHEDULED path is the hourly cron
// dispatcher (/api/cron/dispatch -> cron-runner watchlist job), not this route.
// Non-blocking: the sweep runs in after() so the call returns instantly and the
// Live Analysis Board shows reels appear + progress in real time. Work is bounded
// per call by each competitor's schedule (dueCompetitors()).
export async function POST() {
  enterTenant(await resolveTenant());
  const ctx = { tenantId: tenantId(), userId: currentUserId() };
  after(async () => {
    try {
      await runWithTenant(ctx, () => runWatchlistDue());
    } catch (err) {
      console.error('[competitors/cron] background sweep failed:', (err as Error).message);
    }
  });
  return NextResponse.json({ started: true }, { status: 202 });
}
