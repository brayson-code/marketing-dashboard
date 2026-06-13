// GET  /api/usage-cap  → { enabled, daily_tokens, used_today }
// POST /api/usage-cap  { enabled?, daily_tokens? } → same shape
//
// Owner/admin only. Calls the contract defined by src/lib/usage-cap.ts
// (written by the concurrent agent). If that module doesn't exist yet
// (integration in progress) the route returns a safe 503 rather than crashing.

import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { getUsageCap, setUsageCap, getTodayTokenUsage } from '@/lib/usage-cap';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const [cap, used_today] = await Promise.all([getUsageCap(), getTodayTokenUsage()]);
    return NextResponse.json({ ...cap, used_today });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const body = (await request.json()) as { enabled?: boolean; daily_tokens?: number };

    const patch: { enabled?: boolean; daily_tokens?: number } = {};

    if (typeof body.enabled === 'boolean') {
      patch.enabled = body.enabled;
    }
    if (body.daily_tokens !== undefined) {
      const n = Number(body.daily_tokens);
      if (!Number.isFinite(n) || n < 10_000) {
        return NextResponse.json(
          { error: 'daily_tokens must be a number >= 10,000' },
          { status: 400 },
        );
      }
      patch.daily_tokens = Math.round(n);
    }

    const cap = await setUsageCap(patch);
    const used_today = await getTodayTokenUsage();
    return NextResponse.json({ ok: true, ...cap, used_today });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
