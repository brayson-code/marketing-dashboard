import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { sendSms } from '@/lib/twilio';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/engagement/sms/send — owner-initiated reply from the SMS chat UI.
// Body: { to: string, body: string }
// Delegates to sendSms() which normalises the number, enforces the daily cap,
// calls Twilio, and records the outbound to sms_messages.
export async function POST(req: NextRequest) {
  enterTenant(await resolveTenant());

  let to = '';
  let body = '';
  try {
    const j = (await req.json()) as { to?: unknown; body?: unknown };
    to = String(j.to ?? '').trim();
    body = String(j.body ?? '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!to) return NextResponse.json({ error: '`to` is required' }, { status: 400 });
  if (!body) return NextResponse.json({ error: '`body` is required' }, { status: 400 });

  const result = await sendSms({ to, body });
  if (!result.sent) {
    return NextResponse.json({ ok: false, error: result.reason }, { status: 422 });
  }
  return NextResponse.json({ ok: true, sid: result.sid });
}
