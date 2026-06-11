import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { isConnected, sendEmail } from '@/lib/agentmail';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/integrations/agentmail/send
// Owner-authored direct send from one of THEIR inboxes (the owner is the author
// + approver, so it sends immediately — distinct from agent-drafted emails which
// go through /drafts → approve). Body: { inbox_id, to, subject, text }.
// Sends via the tenant's own AgentMail key, so there's no cross-tenant risk.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) {
    return NextResponse.json({ error: 'AgentMail not connected.' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({})) as {
    inbox_id?: string; to?: string | string[]; subject?: string; text?: string;
  };
  const inboxId = (body.inbox_id ?? '').trim();
  const to = Array.isArray(body.to) ? body.to : (body.to ? [String(body.to).trim()] : []);
  const text = (body.text ?? '').trim();
  if (!inboxId || to.length === 0 || !text) {
    return NextResponse.json({ error: 'inbox_id, to, and text are required' }, { status: 400 });
  }
  try {
    const sent = await sendEmail(inboxId, {
      to,
      subject: (body.subject ?? '').trim() || '(no subject)',
      text,
    });
    return NextResponse.json({ ok: true, message_id: sent.message_id, thread_id: sent.thread_id });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
