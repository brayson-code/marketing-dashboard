import { NextResponse } from 'next/server';
import { getRoiSummary, saveKeyAudit, logTimeSaving } from '@/lib/roi';
import { resolveTenant } from '@/lib/with-tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/roi → full ROI summary (audit + hours/value saved + breakdowns)
export async function GET() {
  await resolveTenant();
  try {
    return NextResponse.json(await getRoiSummary());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/roi → save the Key Audit inputs and/or editable presets
export async function PUT(request: Request) {
  await resolveTenant();
  try {
    const b = await request.json();
    const audit = await saveKeyAudit({
      annual_revenue: b.annual_revenue,
      annual_profit: b.annual_profit,
      hours_per_week: b.hours_per_week,
      admin_percentage: b.admin_percentage,
      presets: b.presets,
    });
    return NextResponse.json({ ok: true, audit });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/roi → manual time-saving log (VA: "the agent saved me N minutes")
export async function POST(request: Request) {
  await resolveTenant();
  try {
    const b = await request.json();
    if (!b.actionType) return NextResponse.json({ error: 'actionType required' }, { status: 400 });
    await logTimeSaving({ actionType: b.actionType, agentId: b.agentId ?? null, minutes: b.minutes, source: 'manual' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
