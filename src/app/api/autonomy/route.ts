import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import {
  getAutonomyConfig, setAutonomyConfig, DRAFT_TYPE_META, AUTONOMY_LEVELS,
  type Autonomy, type OverrideValue,
} from '@/lib/autonomy';
import { getEntitlements } from '@/lib/entitlements';
import type { DraftType } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/autonomy → current config + the catalog the UI needs to render the
// per-type toggles (so the client never has to hardcode draft types).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const config = await getAutonomyConfig();
    return NextResponse.json({
      ...config,
      levels: AUTONOMY_LEVELS,
      types: DRAFT_TYPE_META,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/autonomy { level?, overrides? } → patch one or both. Only valid
// level values and only 'auto' | 'approve' overrides are persisted.
export async function PUT(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const body = (await request.json()) as { level?: string; overrides?: Record<string, string> };
    const patch: { level?: Autonomy; overrides?: Partial<Record<DraftType, OverrideValue>> } = {};
    if (body.level !== undefined) {
      if (!(AUTONOMY_LEVELS as string[]).includes(body.level)) {
        return NextResponse.json({ error: `Invalid level: ${body.level}` }, { status: 400 });
      }
      // Plan gate — can't bypass the UI lock by hitting the API directly.
      const { features } = await getEntitlements();
      if (!(features.autonomy as string[]).includes(body.level)) {
        return NextResponse.json(
          { error: `Autonomy mode "${body.level}" is not included in your plan.` },
          { status: 403 },
        );
      }
      patch.level = body.level as Autonomy;
    }
    if (body.overrides !== undefined) {
      const o: Partial<Record<DraftType, OverrideValue>> = {};
      for (const m of DRAFT_TYPE_META) {
        const v = body.overrides[m.type];
        if (v === 'auto' || v === 'approve') o[m.type] = v;
      }
      patch.overrides = o;
    }
    const next = await setAutonomyConfig(patch);
    return NextResponse.json({ ok: true, ...next });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
