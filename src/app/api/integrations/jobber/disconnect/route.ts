import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { clearIntegration } from '@/lib/integrations-store';
import { getSubject } from '@/lib/authz';
import { createClearApproval } from '@/lib/pending-approvals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/integrations/jobber/disconnect — clears this tenant's stored Jobber
// token pair. (No upstream Jobber revocation call — Jobber's `appDisconnect`
// mutation is app-level plumbing that belongs with the GraphQL client in
// lib/jobber.ts, not the OAuth handshake routes; deleting our own copy of the
// token is what makes the Connections tile show "not connected" and stops us
// from using it, which is what this endpoint is responsible for.)
export async function POST() {
  enterTenant(await resolveTenant());
  try {
    // Deleting the stored credential is the same destructive blast radius as
    // /api/integrations-setup {action:'clear'} — enforce the identical step-up:
    // owner (or billing_admin) executes; a VA/member gets a pending_approvals row.
    const subject = await getSubject({ live: true });
    const mayClear = subject.role === 'owner' || subject.attrs.billing_admin === true;
    if (!mayClear) {
      const approvalId = await createClearApproval('jobber');
      return NextResponse.json(
        {
          ok: false,
          pending_approval: true,
          pending_approval_id: approvalId,
          reason: 'secret_change_requires_owner',
          message: 'Disconnecting Jobber needs owner approval. The request was sent to the workspace owner to confirm.',
        },
        { status: 202 },
      );
    }
    await clearIntegration('jobber');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
