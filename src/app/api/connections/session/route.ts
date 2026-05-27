import { NextResponse } from 'next/server';
import { createConnectSessionToken, isNangoConfigured } from '@/lib/nango';
import { tenantId } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/connections/session
 * Mints a Nango Connect session token for the current tenant so the browser can open
 * the Connect UI. If Nango isn't configured we return { configured: false } with a 200
 * (no token) — this is an expected, non-error state until the OAuth apps are linked.
 */
export async function POST() {
  try {
    if (!isNangoConfigured()) {
      return NextResponse.json({ configured: false });
    }
    const token = await createConnectSessionToken(tenantId());
    return NextResponse.json({ configured: true, token });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
