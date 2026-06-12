// Transactional email with a provider chain — invite links and other one-off
// system mail (NOT agent email, which runs per-tenant through agentmail.ts).
//
// Attempt order:
//   1. Resend (plain fetch, no SDK) — only when RESEND_API_KEY is set. The From
//      address comes from RESEND_FROM, falling back to Resend's shared
//      onboarding sender so a bare key still works out of the box.
//   2. AgentMail under the PLATFORM (HQ) tenant's account — only when the HQ
//      tenant actually has a key (their stored BYO key, or the AGENTMAIL_API_KEY
//      env fallback that agentmail.ts documents as the owner/HQ key). Sends from
//      the HQ account's first inbox.
//   3. Neither configured → { sent:false, reason:'no email provider configured' }.
//
// This module NEVER throws. Email is best-effort everywhere it's used — callers
// (client provisioning, teammate invites) must keep working and surface the
// invite link for manual copy when sending isn't possible.

import { runWithTenant, DEFAULT_TENANT_ID } from './tenant';
import { getAgentMailKey, listInboxes, sendEmail } from './agentmail';

export interface TransactionalEmail {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  provider?: 'resend' | 'agentmail';
  reason?: string;
}

const AGENTMAIL_NOT_CONFIGURED = 'agentmail: no key on the HQ tenant';

/** Send via the HQ tenant's AgentMail account. All AgentMail access (key lookup,
 *  inbox list, send) runs scoped to DEFAULT_TENANT_ID — this is the PLATFORM
 *  sender regardless of which tenant the recipient is being invited into.
 *  runWithTenant wraps only this call; the request's own tenant context outside
 *  is untouched. */
async function sendViaAgentMail(msg: TransactionalEmail): Promise<SendResult> {
  return runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, async () => {
    const key = await getAgentMailKey();
    if (!key) return { sent: false, reason: AGENTMAIL_NOT_CONFIGURED };
    const inboxes = await listInboxes();
    const from = inboxes[0];
    if (!from) return { sent: false, reason: 'agentmail: HQ account has no inbox to send from' };
    // inbox_id IS the email address; sendEmail percent-encodes it in the path.
    await sendEmail(from.inbox_id, { to: [msg.to], subject: msg.subject, text: msg.text, html: msg.html });
    return { sent: true, provider: 'agentmail' as const };
  });
}

/** Try Resend, then AgentMail (HQ account), then degrade to { sent:false }.
 *  Never throws — a missing provider or failed send is a normal outcome here. */
export async function sendTransactionalEmail(msg: TransactionalEmail): Promise<SendResult> {
  const resendKey = process.env.RESEND_API_KEY?.trim();

  // 1) Resend — plain fetch against their REST API.
  if (resendKey) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: process.env.RESEND_FROM || 'KeyPlayers <onboarding@resend.dev>',
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
        }),
      });
      if (res.ok) return { sent: true, provider: 'resend' };
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      console.warn(`[email] resend send failed (${res.status}) — falling through to AgentMail. ${detail}`);
    } catch (e) {
      console.warn('[email] resend unreachable — falling through to AgentMail:', (e as Error).message);
    }
  }

  // 2) AgentMail via the HQ tenant's key.
  let am: SendResult;
  try {
    am = await sendViaAgentMail(msg);
  } catch (e) {
    am = { sent: false, reason: `agentmail: ${(e as Error).message.slice(0, 200)}` };
  }
  if (am.sent) return am;

  // 3) Nothing usable. Inert-but-honest: callers show the copyable link instead.
  if (!resendKey && am.reason === AGENTMAIL_NOT_CONFIGURED) {
    console.warn('[email] no email provider configured (set RESEND_API_KEY, or store an AgentMail key on the HQ tenant) — invite links must be shared manually.');
    return { sent: false, reason: 'no email provider configured' };
  }
  return am;
}

// ── Invite email rendering ───────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Short branded invite email (inline styles — it's email). Returns both the
 *  HTML body and a plain-text fallback so every client renders something. */
export function renderInviteEmail(opts: {
  heading: string;
  body: string;
  ctaLabel: string;
  link: string;
}): { html: string; text: string } {
  const heading = escapeHtml(opts.heading);
  const body = escapeHtml(opts.body);
  const ctaLabel = escapeHtml(opts.ctaLabel);
  const link = escapeHtml(opts.link);

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#0e1116;font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;padding:40px 24px;">
      <p style="color:#10D982;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;margin:0 0 16px;">KeyPlayers Command Center</p>
      <h1 style="color:#f4f6f8;font-size:20px;line-height:1.35;margin:0 0 12px;">${heading}</h1>
      <p style="color:#9aa4b2;font-size:14px;line-height:1.6;margin:0 0 24px;">${body}</p>
      <a href="${link}" style="display:inline-block;background:#10D982;color:#08110c;font-size:14px;font-weight:600;text-decoration:none;padding:11px 22px;border-radius:10px;">${ctaLabel}</a>
      <p style="color:#6b7686;font-size:12px;line-height:1.6;margin:24px 0 0;">If the button doesn't work, paste this link into your browser:<br /><a href="${link}" style="color:#10D982;word-break:break-all;">${link}</a></p>
      <p style="color:#4d5663;font-size:11px;line-height:1.6;margin:32px 0 0;">This link signs you in once so you can set a password. If you weren't expecting this email, you can ignore it.</p>
    </div>
  </body>
</html>`;

  const text = `${opts.heading}\n\n${opts.body}\n\n${opts.ctaLabel}: ${opts.link}\n\nThis link signs you in once so you can set a password. If you weren't expecting this email, you can ignore it.`;

  return { html, text };
}
