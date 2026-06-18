import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { tenantId } from '@/lib/tenant';
import { listIntegrations, upsertIntegration, clearIntegration, PROVIDERS } from '@/lib/integrations-store';
import { validateHeyGenKey } from '@/lib/heygen';
import { validateAnthropicKey } from '@/lib/anthropic-key';
import { getSubject } from '@/lib/authz';
import { createRotateSecretApproval, createClearApproval } from '@/lib/pending-approvals';

export const dynamic = 'force-dynamic';

// Providers we can sanity-check before storing, so "Connect" means "this key
// actually works" rather than "a key was saved". Only runs when the relevant
// secret field is supplied (an Update that leaves it blank keeps the existing one).
const SECRET_VALIDATORS: Record<string, (secret: Record<string, string>) => Promise<{ ok: boolean; error?: string }>> = {
  hyperframes: (secret) => (secret.api_key ? validateHeyGenKey(secret.api_key) : Promise.resolve({ ok: true })),
  anthropic: (secret) => (secret.api_key ? validateAnthropicKey(secret.api_key) : Promise.resolve({ ok: true })),
};

export async function GET() {
  enterTenant(await resolveTenant());
  // tenant_id is returned so the UI can render this workspace's per-tenant webhook
  // URLs (e.g. LoopMessage → /api/webhook/loopmessage/<tenant_id>). It's the
  // workspace id, not a secret — the webhook_secret is what actually authenticates.
  return NextResponse.json({ providers: PROVIDERS, integrations: await listIntegrations(), tenant_id: tenantId() });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: { action?: string; provider?: string; config?: Record<string, unknown>; secret?: Record<string, string>; label?: string; scopes?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.provider) return NextResponse.json({ error: 'provider is required' }, { status: 400 });

  // Clearing an integration DELETES the stored credential — same destructive
  // blast radius as a rotation/disconnect, so it's the SPECIAL secret step-up too:
  // owner (or billing_admin) executes; a VA/member gets a pending_approvals row.
  if (body.action === 'clear') {
    const subject = await getSubject({ live: true });
    const mayClear = subject.role === 'owner' || subject.attrs.billing_admin === true;
    if (!mayClear) {
      const approvalId = await createClearApproval(body.provider);
      return NextResponse.json(
        {
          ok: false,
          pending_approval: true,
          pending_approval_id: approvalId,
          reason: 'secret_change_requires_owner',
          message: 'Clearing this connection needs owner approval. The request was sent to the workspace owner to confirm.',
        },
        { status: 202 },
      );
    }
    await clearIntegration(body.provider);
    return NextResponse.json({ ok: true });
  }

  const validate = SECRET_VALIDATORS[body.provider];
  if (validate && body.secret) {
    const result = await validate(body.secret);
    if (!result.ok) return NextResponse.json({ error: result.error || 'Key validation failed' }, { status: 400 });
  }

  // SPECIAL step-up (VA permission matrix): a write that CARRIES A SECRET is a
  // key/secret rotation — the one operational action a VA/member may NOT do directly.
  // Owner (or a member with the explicit billing_admin attr) executes immediately;
  // anyone else gets a pending_approvals row INSTEAD of executing, and the owner
  // approves it in-app (/api/approvals/pending). The secret is encrypted into the
  // payload — never stored as plaintext. Non-secret config writes fall through and
  // execute as before (VA configures the workspace on the owner's behalf).
  //
  // Real 403/202 here is independent of AUTHZ_ENFORCE; single-owner prod is unaffected
  // (the owner always executes). Mirrors policies/client-integrations.ts (rotate_secret).
  const carriesSecret = !!body.secret && Object.keys(body.secret).length > 0;
  if (carriesSecret) {
    const subject = await getSubject({ live: true });
    const mayRotate = subject.role === 'owner' || subject.attrs.billing_admin === true;
    if (!mayRotate) {
      const approvalId = await createRotateSecretApproval({
        provider: body.provider,
        label: body.label,
        config: body.config,
        scopes: body.scopes,
        secret: body.secret!,
      });
      return NextResponse.json(
        {
          ok: false,
          pending_approval: true,
          pending_approval_id: approvalId,
          reason: 'secret_change_requires_owner',
          message:
            'Saving this key needs owner approval. The request was sent to the workspace owner to confirm.',
        },
        { status: 202 },
      );
    }
  }

  const row = await upsertIntegration({
    provider: body.provider,
    label: body.label,
    config: body.config,
    secret: body.secret,
    scopes: body.scopes,
  });
  return NextResponse.json({ ok: true, integration: row });
}
