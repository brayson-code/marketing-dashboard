import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/tenant';
import { getDecryptedSecret } from '@/lib/integrations-store';
import { tenantExists } from '@/lib/webhook-tenant';
import { processLoopMessageWebhook } from '@/lib/loopmessage-webhook';
import { rateLimit } from '@/lib/rate-limit';

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

  // Per-tenant rate limit — each accepted inbound message can spawn an orchestrator
  // reply (LLM spend), and this is a public URL keyed only by a guessable workspace
  // id (audit finding #5). Cap inbound bursts per workspace; the per-tenant webhook
  // secret (checked below) is still the real auth. 30/min absorbs normal iMessage
  // traffic while braking a flood. Keyed on the path tenant id, not ALS.
  const rl = rateLimit('webhook-loopmessage', tenantId, { windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
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
