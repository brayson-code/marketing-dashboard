import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getTrendRadar } from '@/lib/trends';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/competitors/trends?days=30 — the Trend Radar (pure aggregation, no
// agent cost). Returns a TrendRadar: hot tags + top reels in the window + the
// reel-analyst's pulse. Defaults to a 30-day window; ignores junk `days`.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const { searchParams } = new URL(request.url);
    const days = Number(searchParams.get('days')) || 30;
    return NextResponse.json(await getTrendRadar({ days }));
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
