import { NextResponse } from 'next/server';
import {
  isNangoConfigured,
  listProviderStatus,
  recordConnection,
  disconnect,
} from '@/lib/nango';
import { resolveTenant } from '@/lib/with-tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/connections → configured flag + per-provider connection status. */
export async function GET() {
  await resolveTenant();
  try {
    const providers = await listProviderStatus();
    return NextResponse.json({ configured: isNangoConfigured(), providers });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/**
 * POST /api/connections
 * body: { provider, connectionId, providerConfigKey }
 * Records a successful OAuth connection for the current tenant.
 */
export async function POST(request: Request) {
  await resolveTenant();
  try {
    const body = (await request.json()) as {
      provider?: string;
      connectionId?: string;
      providerConfigKey?: string;
    };
    if (!body.provider || !body.connectionId || !body.providerConfigKey) {
      return NextResponse.json(
        { error: 'provider, connectionId and providerConfigKey are required' },
        { status: 400 },
      );
    }
    await recordConnection(body.provider, body.connectionId, body.providerConfigKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

/** DELETE /api/connections?provider=x → disconnect a provider for the current tenant. */
export async function DELETE(request: Request) {
  await resolveTenant();
  try {
    const provider = new URL(request.url).searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'provider query param is required' }, { status: 400 });
    }
    await disconnect(provider);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
