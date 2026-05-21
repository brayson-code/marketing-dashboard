import { NextRequest, NextResponse } from 'next/server';
import { requireApiUser } from '@/lib/api-auth';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { clampDays } from '@/lib/analytics';
import { summarizeCycleTimes, percentImprovement } from '@/lib/benchmarks';

export const dynamic = 'force-dynamic';

type CycleTimeRow = {
  cycle_hours: number;
};

function parseLaunchDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoOrNull(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

async function queryCycleTimes(
  startIso: string,
  endIso: string,
): Promise<number[]> {
  // Note: seed filtering is a no-op (no seed_registry table in Supabase).
  // Cycle hours: difference between earliest qualifying sequence and the lead
  // creation time, expressed in hours (timestamptz epoch math).
  const rows = await sql()`
    SELECT (EXTRACT(EPOCH FROM (MIN(s.created_at) - l.created_at)) / 3600.0) AS cycle_hours
    FROM leads l
    JOIN sequences s ON s.lead_id = l.id AND s.tenant_id = ${DEFAULT_TENANT_ID}
    WHERE l.tenant_id = ${DEFAULT_TENANT_ID}
      AND s.status IN ('approved', 'queued')
      AND l.created_at >= ${startIso}::timestamptz
      AND l.created_at < ${endIso}::timestamptz
    GROUP BY l.id, l.created_at
  ` as unknown as CycleTimeRow[];

  return rows
    .map((r) => Number(r.cycle_hours))
    .filter((h) => Number.isFinite(h) && h >= 0);
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;

  const days = clampDays(req.nextUrl.searchParams.get('days'), 30);
  const now = new Date();
  const launchAt = parseLaunchDate(
    req.nextUrl.searchParams.get('launch_at') || process.env.HERMES_BENCHMARK_HERMES_LAUNCH_AT,
  );

  let beforeStart: Date;
  let beforeEnd: Date;
  let afterStart: Date;
  let afterEnd: Date;
  let baselineMode: 'rolling_window' | 'launch_anchored';

  if (launchAt) {
    baselineMode = 'launch_anchored';
    const dMs = days * 24 * 60 * 60 * 1000;
    beforeEnd = new Date(launchAt.getTime());
    beforeStart = new Date(launchAt.getTime() - dMs);
    afterStart = new Date(launchAt.getTime());
    const launchPlusWindow = new Date(launchAt.getTime() + dMs);
    afterEnd = launchPlusWindow.getTime() < now.getTime() ? launchPlusWindow : now;
  } else {
    baselineMode = 'rolling_window';
    const dMs = days * 24 * 60 * 60 * 1000;
    afterEnd = new Date(now.getTime());
    afterStart = new Date(now.getTime() - dMs);
    beforeEnd = new Date(afterStart.getTime());
    beforeStart = new Date(afterStart.getTime() - dMs);
  }

  const beforeValues = await queryCycleTimes(beforeStart.toISOString(), beforeEnd.toISOString());
  const afterValues = await queryCycleTimes(afterStart.toISOString(), afterEnd.toISOString());

  const beforeStats = summarizeCycleTimes(beforeValues.map((cycleHours) => ({ cycleHours })));
  const afterStats = summarizeCycleTimes(afterValues.map((cycleHours) => ({ cycleHours })));

  const medianDeltaPct = percentImprovement(beforeStats.medianHours, afterStats.medianHours);
  const p90DeltaPct = percentImprovement(beforeStats.p90Hours, afterStats.p90Hours);

  return NextResponse.json({
    metric: 'lead_to_approved_campaign_cycle_time_hours',
    days,
    baseline_mode: baselineMode,
    window: {
      before: { start: beforeStart.toISOString(), end: beforeEnd.toISOString() },
      after: { start: afterStart.toISOString(), end: afterEnd.toISOString() },
      now: now.toISOString(),
      launch_at: toIsoOrNull(launchAt),
    },
    before: beforeStats,
    after: afterStats,
    delta: {
      median_pct: medianDeltaPct,
      p90_pct: p90DeltaPct,
    },
    inclusion_rules: [
      'Lead cohort is based on lead.created_at within each window.',
      "Cycle time is MIN(sequence.created_at where sequence.status in ['approved','queued']) - lead.created_at.",
      'Only non-negative cycle times are counted.',
      'real=true excludes seeded records.',
    ],
  });
}
