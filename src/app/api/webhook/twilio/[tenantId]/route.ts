import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/tenant';
import { tenantExists } from '@/lib/webhook-tenant';
import { handleTwilioInbound } from '@/lib/twilio-webhook';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PER-TENANT Twilio inbound SMS webhook: /api/webhook/twilio/[tenantId]
//
// Point your Twilio phone number's "A message comes in" webhook (POST) at this
// URL with THIS workspace id in the path. We validate the tenant, then run the
// handler INSIDE runWithTenant so the inbound SMS lands in that client's
// workspace. Auth = the Twilio request signature, verified against the tenant's
// stored auth token (handleTwilioInbound). Returns empty TwiML so Twilio doesn't
// auto-reply.
export async function POST(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  if (!(await tenantExists(tenantId))) {
    return NextResponse.json({ error: 'Unknown workspace' }, { status: 404 });
  }

  // Per-tenant rate limit — each accepted inbound SMS can spawn an orchestrator
  // reply (LLM spend), and this is a public URL keyed only by a guessable workspace
  // id (audit finding #5). The Twilio request signature (verified in
  // handleTwilioInbound) is the real auth; this caps inbound bursts per workspace.
  // 30/min absorbs normal SMS traffic while braking a flood. Keyed on the path id.
  const rl = rateLimit('webhook-twilio', tenantId, { windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  const path = `/api/webhook/twilio/${tenantId}`;
  const result = await runWithTenant({ tenantId, userId: null }, () => handleTwilioInbound(request, path));

  if (!result.ok) {
    return NextResponse.json({ error: result.reason ?? 'rejected' }, { status: result.status });
  }
  // Empty TwiML — accepted, no auto-reply.
  return new NextResponse('<?xml version="1.0" encoding="UTF-8"?><Response></Response>', {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  });
}
