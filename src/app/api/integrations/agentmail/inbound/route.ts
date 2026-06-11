import { NextResponse } from 'next/server';
import { runWithTenant } from '@/lib/tenant';
import { verifyWebhook } from '@/lib/agentmail';
import { findInboxByAccount, recordInbound } from '@/lib/agentmail-inboxes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/integrations/agentmail/inbound
// AgentMail pushes inbound emails here for ALL tenants. There is no auth header —
// authenticity is established by (a) HMAC-verifying the body against the inbox's
// stored webhook secret when we have one, and (b) the account_id resolving to an
// inbox WE provisioned. We route to the owning tenant by account_id, persist the
// email, and surface it in the Engagement email lane for triage. We do NOT
// auto-reply — the owner triages + approves (keeps autonomy + cost in check).
export async function POST(request: Request) {
  // Read the raw body first (needed for HMAC verification).
  const raw = await request.text();
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  // Extract the inbox + message defensively — tolerate a few payload shapes.
  const data = (payload.data ?? payload) as Record<string, unknown>;
  const message = (data.message ?? data) as Record<string, unknown>;
  // agentmail.to identifies the inbox as `inbox_id`; tolerate a few shapes.
  const accountId = String(
    message.inbox_id ?? data.inbox_id ?? payload.inbox_id ??
    message.accountId ?? payload.account_id ?? data.account_id ?? '',
  );
  if (!accountId) return NextResponse.json({ ok: true, skipped: 'no inbox id' });

  // Only inbound emails are actionable.
  const direction = String(message.direction ?? data.direction ?? 'inbound');
  if (direction === 'outbound') return NextResponse.json({ ok: true, skipped: 'outbound' });

  // Route to the owning tenant. Unknown account = not ours → drop silently.
  const inbox = await findInboxByAccount(accountId);
  if (!inbox) return NextResponse.json({ ok: true, skipped: 'unknown account' });

  // Verify the HMAC when we captured a webhook secret at registration. When we
  // don't have one, we accept (the account_id resolving to a provisioned inbox
  // is the authenticity floor) but log it as unverified.
  const sig = request.headers.get('x-agentmail-signature') ?? '';
  const ts = request.headers.get('x-agentmail-timestamp') ?? '';
  if (inbox.webhook_secret) {
    if (!verifyWebhook(raw, sig, ts, inbox.webhook_secret)) {
      return NextResponse.json({ ok: false, error: 'bad signature' }, { status: 401 });
    }
  } else {
    console.warn(`[agentmail] inbound for ${accountId} accepted UNVERIFIED (no stored webhook secret)`);
  }

  // Persist under the resolved tenant. runWithTenant (storage.run) scopes the
  // whole callback in one context — immune to the enterWith-after-await footgun
  // (a later Promise.all couldn't leak to the wrong tenant).
  try {
    await runWithTenant({ tenantId: inbox.tenant_id, userId: null }, async () => {
      const messageId = String(message.message_id ?? message.id ?? data.message_id ?? `${accountId}:${Date.now()}`);
      const from = String(message.from ?? data.from ?? 'unknown@unknown');
      const to = message.to ?? data.to ?? inbox.address;
      const subject = (message.subject ?? data.subject ?? null) as string | null;
      const bodyText = (message.bodyText ?? message.text ?? data.bodyText ?? data.text ?? null) as string | null;
      await recordInbound({
        accountId,
        messageId,
        from,
        to: Array.isArray(to) ? to.join(', ') : (to as string | null),
        subject,
        bodyText,
      });
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error('[agentmail] inbound persist failed:', (e as Error).message);
    return NextResponse.json({ ok: false, error: 'persist failed' }, { status: 500 });
  }
}
