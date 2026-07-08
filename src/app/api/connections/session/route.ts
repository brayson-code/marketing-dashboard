import { NextResponse } from 'next/server';
import { createConnectSessionToken, isNangoConfigured } from '@/lib/nango';
import { tenantId } from '@/lib/tenant';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/connections/session
 * Mints a Nango Connect session token for the current tenant so the browser can open
 * the Connect UI. If Nango isn't configured we return { configured: false } with a 200
 * (no token) — this is an expected, non-error state until the OAuth apps are linked.
 */
export async function POST() {
  enterTenant(await resolveTenant());
  try {
    if (!isNangoConfigured()) {
      return NextResponse.json({ configured: false });
    }
    const token = await createConnectSessionToken(tenantId());
    if (!token) {
      // createConnectSessionToken already console.error'd the underlying cause —
      // surface a generic-but-actionable message to the panel instead of a bare
      // { configured: true, token: null } the caller has no way to act on.
      return NextResponse.json(
        { error: 'Nango session failed — check NANGO_SECRET_KEY and integration config keys' },
        { status: 502 },
      );
    }
    return NextResponse.json({ configured: true, token });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
