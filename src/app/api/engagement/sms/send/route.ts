import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { sendMessage, type MessagingChannel } from '@/lib/messaging';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/engagement/sms/send — owner-initiated reply from the chat UI.
// Body: { to: string, body: string, channel?: 'auto'|'sms'|'imessage' }
// Delegates to sendMessage() which routes to the workspace's chosen provider
// (Twilio SMS / LoopMessage iMessage), normalises the number, and records the
// outbound to sms_messages.
export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());

  let to = '';
  let body = '';
  let channel: MessagingChannel | 'auto' = 'auto';
  try {
    const j = (await req.json()) as { to?: unknown; body?: unknown; channel?: unknown };
    to = String(j.to ?? '').trim();
    body = String(j.body ?? '').trim();
    if (j.channel === 'sms' || j.channel === 'imessage') channel = j.channel;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!to) return NextResponse.json({ error: '`to` is required' }, { status: 400 });
  if (!body) return NextResponse.json({ error: '`body` is required' }, { status: 400 });

  const result = await sendMessage({ to, body, channel });
  if (!result.sent) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
  }
  return NextResponse.json({ ok: true, sid: result.sid, channel: result.channel });
}
