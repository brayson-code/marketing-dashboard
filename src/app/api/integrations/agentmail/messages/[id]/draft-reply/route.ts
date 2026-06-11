import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { spawnSubAgent } from '@/lib/subagent';
import { createDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/integrations/agentmail/messages/[id]/draft-reply
// Dispatch outreach-sender to draft a reply to an inbound email, then write it
// to /drafts tagged for AgentMail send. Approving in /drafts → sendEmail routes
// it back out through the tenant's AgentMail account, threaded to the original.
// Same pattern as the YouTube/IG comment draft-reply, for email.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params; // agentmail_messages.id (our row id)

  const rows = (await sql()`
    SELECT account_id, message_id, from_addr, subject, body_text
    FROM public.agentmail_messages
    WHERE tenant_id = ${tenantId()} AND id = ${Number(id)}
    LIMIT 1
  `) as unknown as Array<{ account_id: string; message_id: string; from_addr: string; subject: string | null; body_text: string | null }>;
  const msg = rows[0];
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const brief = [
    `Draft a reply to this inbound email. Output ONLY the reply body — no subject line, no quoted original, no signature block unless natural.`,
    `From: ${msg.from_addr}`,
    msg.subject ? `Subject: ${msg.subject}` : '',
    `Their message:\n${(msg.body_text ?? '').slice(0, 2000)}`,
    `Constraints: professional, concise, move the conversation forward. If it's spam or clearly not a real prospect, draft a brief polite close.`,
  ].filter(Boolean).join('\n\n');

  const res = await spawnSubAgent('outreach-sender', brief);
  if (!res.ok || !res.text) {
    return NextResponse.json({ error: res.error ?? 'outreach-sender returned no text' }, { status: 502 });
  }
  const replyText = res.text.trim();
  const subject = msg.subject ? (/^re:/i.test(msg.subject) ? msg.subject : `Re: ${msg.subject}`) : 'Re: your message';

  try {
    const draft = await createDraft({
      type: 'email',
      title: `Email reply → ${msg.from_addr}`,
      payload: replyText,
      createdBy: 'outreach-sender',
      metadata: {
        platform: 'agentmail',
        agentmail: {
          account_id: msg.account_id,
          to: [msg.from_addr],
          subject,
          in_reply_to: msg.message_id,
          message_id: msg.message_id, // so send marks this inbound replied
        },
      },
    });
    return NextResponse.json({ ok: true, draft_id: draft.id, preview: replyText });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
