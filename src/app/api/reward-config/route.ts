import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// Default reward weights (used when no row exists yet).
const DEFAULTS = { approval: 0.5, outcome: 0.3, reliability: 0.2 };

interface RewardRow {
  w_approval: number | string;
  w_outcome: number | string;
  w_reliability: number | string;
}

// GET → current reward weights for the default tenant.
export async function GET() {
  try {
    const rows = (await sql()`
      SELECT w_approval, w_outcome, w_reliability
      FROM public.reward_config
      WHERE tenant_id = ${tenantId()}
    `) as unknown as RewardRow[];

    const row = rows[0];
    const weights = row
      ? {
          approval: Number(row.w_approval),
          outcome: Number(row.w_outcome),
          reliability: Number(row.w_reliability),
        }
      : { ...DEFAULTS };

    return NextResponse.json({ weights });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

// PUT → set + normalize reward weights (each >= 0, normalized to sum to 1).
export async function PUT(request: Request) {
  let body: { approval?: unknown; outcome?: unknown; reliability?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const raw = {
    approval: body.approval,
    outcome: body.outcome,
    reliability: body.reliability,
  };

  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return NextResponse.json(
        { error: `${key} must be a finite number >= 0` },
        { status: 400 },
      );
    }
  }

  const approval = raw.approval as number;
  const outcome = raw.outcome as number;
  const reliability = raw.reliability as number;

  const sum = approval + outcome + reliability;
  if (sum === 0) {
    return NextResponse.json(
      { error: 'weights must sum to more than 0' },
      { status: 400 },
    );
  }

  const weights = {
    approval: approval / sum,
    outcome: outcome / sum,
    reliability: reliability / sum,
  };

  try {
    await sql()`
      UPDATE public.reward_config SET
        w_approval = ${weights.approval},
        w_outcome = ${weights.outcome},
        w_reliability = ${weights.reliability},
        updated_at = now()
      WHERE tenant_id = ${tenantId()}
    `;
    return NextResponse.json({ weights });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
