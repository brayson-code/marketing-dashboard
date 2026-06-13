// GET  /api/google-actions → { enabled: boolean, connected: boolean }
// POST /api/google-actions { enabled: boolean } → same shape + ok: true
//
// Controls business_profile.google_actions_enabled. Mirrors the usage-cap /
// autonomy setting pattern (read-modify-write on the tenants.business_profile
// jsonb). The toggle is OFF by default; a tenant must explicitly enable it AND
// have a connected Google Workspace account before agents can use Workspace tools.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, jsonb, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getState(): Promise<{ enabled: boolean; connected: boolean }> {
  const [bpRows, connRows] = await Promise.all([
    sql()`
      SELECT business_profile FROM public.tenants
      WHERE id = ${tenantId()} LIMIT 1
    ` as unknown as Promise<Array<{ business_profile: Record<string, unknown> | null }>>,
    sql()`
      SELECT 1 FROM connections
      WHERE tenant_id = ${tenantId()}
        AND provider = 'google-workspace'
        AND status = 'connected'
      LIMIT 1
    ` as unknown as Promise<Array<Record<string, unknown>>>,
  ]);
  const bp = bpRows[0]?.business_profile ?? {};
  return {
    enabled: bp.google_actions_enabled === true,
    connected: connRows.length > 0,
  };
}

export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json(await getState());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const body = (await request.json()) as { enabled?: unknown };
    if (typeof body.enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 });
    }

    // Read-modify-write — never clobbers other business_profile keys.
    const rows = (await sql()`
      SELECT business_profile FROM public.tenants
      WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
    const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
    bp.google_actions_enabled = body.enabled;
    await sql()`
      UPDATE public.tenants SET business_profile = ${jsonb(bp)}
      WHERE id = ${tenantId()}
    `;

    return NextResponse.json({ ok: true, ...(await getState()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
