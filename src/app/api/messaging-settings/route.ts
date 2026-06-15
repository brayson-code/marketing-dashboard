// GET  /api/messaging-settings → { provider, autoRoute, twilioConnected, loopConnected }
// POST /api/messaging-settings { provider?, autoRoute? } → same shape + ok: true
//
// Controls the tenant's outbound-messaging provider choice, stored on
// tenants.business_profile (messaging_provider + messaging_auto_route). Mirrors
// the google-actions / usage-cap read-modify-write pattern so it never clobbers
// other business_profile keys. Connection state comes from the integrations-store
// (Twilio creds / LoopMessage auth key), not a separate table.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import { connectedProviders, getMessagingSettings, type MessagingProvider } from '@/lib/messaging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function getState() {
  const [settings, connected] = await Promise.all([getMessagingSettings(), connectedProviders()]);
  return {
    provider: settings.provider,
    autoRoute: settings.autoRoute,
    twilioConnected: connected.twilio,
    loopConnected: connected.loopmessage,
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
    const body = (await request.json()) as { provider?: unknown; autoRoute?: unknown };
    if (body.provider !== undefined && body.provider !== 'twilio' && body.provider !== 'loopmessage') {
      return NextResponse.json({ error: "provider must be 'twilio' or 'loopmessage'" }, { status: 400 });
    }
    if (body.autoRoute !== undefined && typeof body.autoRoute !== 'boolean') {
      return NextResponse.json({ error: 'autoRoute must be a boolean' }, { status: 400 });
    }

    const rows = (await sql()`
      SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
    const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
    if (body.provider !== undefined) bp.messaging_provider = body.provider as MessagingProvider;
    if (body.autoRoute !== undefined) bp.messaging_auto_route = body.autoRoute;
    await sql()`
      UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
    `;

    return NextResponse.json({ ok: true, ...(await getState()) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
