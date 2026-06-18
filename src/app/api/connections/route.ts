import { NextResponse } from 'next/server';
import {
  isNangoConfigured,
  listProviderStatus,
  recordConnection,
  disconnect,
} from '@/lib/nango';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getSubject } from '@/lib/authz';
import { createDisconnectApproval } from '@/lib/pending-approvals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET /api/connections → configured flag + per-provider connection status. */
export async function GET() {
  enterTenant(await resolveTenant());
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
  enterTenant(await resolveTenant());
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
  enterTenant(await resolveTenant());
  try {
    const provider = new URL(request.url).searchParams.get('provider');
    if (!provider) {
      return NextResponse.json({ error: 'provider query param is required' }, { status: 400 });
    }

    // SPECIAL step-up (VA permission matrix): disconnect destroys a credential, so
    // it is the same owner-step-up case as a secret rotation. Owner (or billing_admin)
    // disconnects immediately; a VA/member gets a pending_approvals row INSTEAD, and
    // the owner approves it in-app (/api/approvals/pending). Real 202 here is
    // independent of AUTHZ_ENFORCE; single-owner prod is unaffected (owner executes).
    // Mirrors policies/client-integrations.ts (disconnect).
    const subject = await getSubject({ live: true });
    const mayDisconnect = subject.role === 'owner' || subject.attrs.billing_admin === true;
    if (!mayDisconnect) {
      const approvalId = await createDisconnectApproval(provider);
      return NextResponse.json(
        {
          ok: false,
          pending_approval: true,
          pending_approval_id: approvalId,
          reason: 'secret_change_requires_owner',
          message:
            'Disconnecting this provider needs owner approval. The request was sent to the workspace owner to confirm.',
        },
        { status: 202 },
      );
    }

    await disconnect(provider);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
