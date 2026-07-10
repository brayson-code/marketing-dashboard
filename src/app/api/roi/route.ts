import { NextResponse } from 'next/server';
import { getRoiSummary, saveKeyAudit, logTimeSaving } from '@/lib/roi';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { memo } from '@/lib/cache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/roi → full ROI summary (audit + hours/value saved + breakdowns)
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json(await memo(`roi:${tenantId()}`, 30000, () => getRoiSummary()));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Coerce an incoming audit field to a finite number, or null. Anything
// non-numeric (empty string, "abc", NaN, Infinity) becomes null so it can't
// reach the numeric DB column and blow up as a 500 — it's simply "unset".
function coerceNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// PUT /api/roi → save the Key Audit inputs and/or editable presets
export async function PUT(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const b = await request.json().catch(() => ({}));
    // Sanitize presets: keep only finite-number values (drop NaN/strings).
    let presets: Record<string, number> | undefined;
    if (b.presets && typeof b.presets === 'object') {
      presets = {};
      for (const [k, val] of Object.entries(b.presets as Record<string, unknown>)) {
        const n = Number(val);
        if (Number.isFinite(n)) presets[k] = n;
      }
    }
    const audit = await saveKeyAudit({
      annual_revenue: coerceNum(b.annual_revenue),
      annual_profit: coerceNum(b.annual_profit),
      hours_per_week: coerceNum(b.hours_per_week),
      admin_percentage: coerceNum(b.admin_percentage),
      presets,
    });
    return NextResponse.json({ ok: true, audit });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/roi → manual time-saving log (VA: "the agent saved me N minutes")
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const b = await request.json().catch(() => ({}));
    if (!b.actionType || typeof b.actionType !== 'string') {
      return NextResponse.json({ error: 'actionType required' }, { status: 400 });
    }
    // Guard minutes: a non-finite value would store NaN in the numeric column and
    // poison every SUM. undefined → let logTimeSaving fall back to the preset.
    const minutes = coerceNum(b.minutes) ?? undefined;
    await logTimeSaving({ actionType: b.actionType, agentId: b.agentId ?? null, minutes, source: 'manual' });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
