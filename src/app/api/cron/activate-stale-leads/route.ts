import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiEditor } from '@/lib/api-auth';
import { sql, jsonb, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// One-click activation for the daily stale-lead follow-up sweep. The sweep is
// gated by business_profile.stale_lead_sweep_enabled (default off → nothing
// runs). This flips that flag on; the daily cron then drafts replies to leads
// who replied but haven't been answered, into the approval queue. It only ever
// creates DRAFTS — it never sends — and spends on the tenant's own Claude key.

async function isEnabled(): Promise<boolean> {
  const rows = (await sql()`
    SELECT (business_profile->>'stale_lead_sweep_enabled') AS v
    FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ v: string | null }>;
  return rows[0]?.v === 'true';
}

// GET → whether the sweep is on (the activation card self-hides once enabled).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ enabled: await isEnabled() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST → turn the sweep on for this workspace.
export async function POST(req: Request) {
  enterTenant(await resolveTenant());
  const denied = requireApiEditor(req);
  if (denied) return denied;
  try {
    const rows = (await sql()`
      SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
    const bp = { ...(rows[0]?.business_profile ?? {}), stale_lead_sweep_enabled: true };
    await sql()`
      UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
    `;
    return NextResponse.json({ ok: true, enabled: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
