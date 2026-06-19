import { NextResponse } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runUptimeCheck } from '@/lib/uptime';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Vercel Cron uptime sweep — the SECONDARY monitor. Runs the in-process liveness
// self-check and alerts the HQ owner on a newly-detected failure.
//
// CADENCE LIMITATION: Vercel Cron's finest practical schedule on this project is
// HOURLY (sub-hour rounds to the top of the hour). So this can only catch a
// sustained outage within ~1 hour — NOT a fast-detection monitor. The real
// fast path is an EXTERNAL 1-min pinger against /api/health/live. See
// ops/docs/uptime-monitoring.md. To enable this hourly net, add to vercel.json:
//   { "path": "/api/cron/uptime", "schedule": "0 * * * *" }
// and add '/api/cron/uptime' to CRON_RUNNER_PATHS in src/proxy.ts so the cron
// runner (Bearer CRON_SECRET) can reach it unauthenticated-by-session.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;

  try {
    const result = await runUptimeCheck();
    // 200 even when unhealthy: the cron itself succeeded (it correctly detected +
    // alerted). The health verdict is in the body, not the HTTP status, so a
    // failing dependency doesn't make the cron look broken in Vercel's UI.
    return NextResponse.json(result);
  } catch (err) {
    console.error('[cron:uptime] unexpected:', (err as Error).message);
    return NextResponse.json({ ok: false, error: 'uptime check threw' }, { status: 500 });
  }
}
