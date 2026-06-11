import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/tenant';
import { getDecryptedSecret } from '@/lib/integrations-store';
import { tenantExists } from '@/lib/webhook-tenant';
import { processLoopMessageWebhook } from '@/lib/loopmessage-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PER-TENANT LoopMessage inbound webhook: /api/webhook/loopmessage/[tenantId]
//
// Each client points their LoopMessage webhook at this URL with THEIR workspace id
// in the path. We validate the tenant, then run the whole handler INSIDE
// runWithTenant so every write (boardroom_messages, activity_log, notifications)
// and every deferred orchestrator reply lands in that client's workspace — never HQ.
//
// Auth is the PER-TENANT webhook secret stored on the tenant's `loopmessage`
// integration. Unlike the legacy route, a secret is REQUIRED here: without it,
// anyone who knew (or guessed) a tenant id could inject iMessages into that
// workspace. No secret configured → 403 (set it on the Connections page first).
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  if (!(await tenantExists(tenantId))) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 404 });
  }

  return runWithTenant({ tenantId, userId: null }, async () => {
    const secret = (await getDecryptedSecret('loopmessage'))?.webhook_secret?.trim();
    if (!secret) {
      return NextResponse.json(
        { error: 'LoopMessage webhook is not configured for this workspace. Add a Webhook Secret on the Connections page.' },
        { status: 403 },
      );
    }
    return processLoopMessageWebhook(request, secret);
  });
}
