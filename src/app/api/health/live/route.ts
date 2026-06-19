import { NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Unauthenticated liveness probe — the target an EXTERNAL uptime monitor pings
// (Better Uptime / UptimeRobot / Vercel monitor) at 1–5 min granularity. See
// ops/docs/uptime-monitoring.md for why an external pinger is required (the
// hourly Vercel cron can't do minute-level checks).
//
// SECURITY: this route is intentionally public (allow-listed in src/proxy.ts).
// It therefore takes NO tenant context (no resolveTenant/enterTenant) and returns
// ONLY liveness booleans + a timestamp — never any tenant row, count, or name.
// The full, tenant-scoped health picture stays behind auth at /api/health.
//
// Contract:
//   200 { ok: true,  db: 'ok',   ts }   — app + database are up
//   503 { ok: false, db: 'down', ts }   — database unreachable (the thing that
//                                          actually takes the app down)
export async function GET() {
  let db: 'ok' | 'down' = 'ok';
  try {
    await sql()`SELECT 1`;
  } catch {
    db = 'down';
  }

  const ok = db === 'ok';
  return NextResponse.json(
    { ok, db, ts: new Date().toISOString() },
    {
      status: ok ? 200 : 503,
      // Never let a CDN/proxy cache a liveness result.
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    },
  );
}
