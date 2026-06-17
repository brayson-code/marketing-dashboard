import { NextResponse, after } from 'next/server';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import { runWithTenant, currentUserId } from '@/lib/tenant';
import { createNotification } from '@/lib/notifications';
import { runOrchestrator } from '@/lib/orchestrator';
import { sendIMessage, getTenantOwnerPhone } from '@/lib/loopmessage';
import { normalizeToE164 } from '@/lib/twilio';
import { parseIntent, executeIntent } from '@/lib/intents';
import type { Attachment } from '@/lib/vision';

// Shared LoopMessage inbound handler. Writes scope to tenantId() — so the caller
// controls the tenant: the legacy /api/webhook/loopmessage route runs it with no
// tenant context (→ HQ default), while the per-tenant
// /api/webhook/loopmessage/[tenantId] route runs it INSIDE runWithTenant so every
// write lands in the right client's workspace. `expectedSecret` is the secret to
// verify the request against (global env for legacy, per-tenant for the param route).

function extractAttachments(body: Record<string, unknown>): Attachment[] {
  const out: Attachment[] = [];
  const push = (url: unknown, type?: unknown, name?: unknown) => {
    if (typeof url === 'string' && url.startsWith('http')) {
      out.push({
        url,
        type: typeof type === 'string' ? type : undefined,
        name: typeof name === 'string' ? name : undefined,
      });
    }
  };
  const raw = body.attachments;
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === 'string') push(item);
      else if (item && typeof item === 'object') {
        const o = item as Record<string, unknown>;
        push(o.url ?? o.media_url ?? o.link, o.type ?? o.content_type ?? o.mime_type, o.name ?? o.filename);
      }
    }
  }
  push(body.media_url, body.media_type);
  push(body.attachment_url, body.attachment_type);
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

// LoopMessage's webhook config sends a custom header value on every hit; compare it
// constant-time against `expectedSecret`.
//
// If NO secret is configured we FAIL CLOSED in production: an unconfigured secret must
// not authorize every request, or this public route becomes an unauthenticated,
// billable (it kicks off runOrchestrator) owner-spoofing injection vector into HQ.
// Only local dev keeps the skip-when-unset convenience. (The per-tenant route already
// 403s before calling here when no per-tenant secret exists, so this guard is the
// legacy/global-secret path's backstop.)
function isAuthorized(request: Request, expectedSecret: string | undefined): boolean {
  const expected = expectedSecret?.trim();
  if (!expected) return process.env.NODE_ENV !== 'production';
  const candidates = [
    request.headers.get('authorization'),
    request.headers.get('x-loop-secret'),
    request.headers.get('x-webhook-secret'),
  ].filter(Boolean) as string[];
  for (const raw of candidates) {
    const value = raw.startsWith('Bearer ') ? raw.slice(7) : raw;
    if (value.length === expected.length) {
      let diff = 0;
      for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
      if (diff === 0) return true;
    }
  }
  return false;
}

export async function processLoopMessageWebhook(request: Request, expectedSecret: string | undefined): Promise<NextResponse> {
  if (!isAuthorized(request, expectedSecret)) {
    await sql()`
      INSERT INTO activity_log (tenant_id, ts, action, detail, result)
      VALUES (${tenantId()}, now(), 'loopmessage_rejected', 'inbound webhook rejected (missing/incorrect secret header)', 'warn')
    `.catch(() => {});
    return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Capture the active tenant so deferred work (after()) — which runs AFTER the
  // response, OUTSIDE this request's AsyncLocalStorage scope — re-enters the SAME
  // tenant. Without this the orchestrator/intent reply would silently fall back to
  // the HQ default and write into the wrong workspace.
  const ctx = { tenantId: tenantId(), userId: currentUserId() };

  const eventType = typeof body.event === 'string' ? body.event : (typeof body.alert_type === 'string' ? body.alert_type : 'unknown');
  const contact = (body.contact ?? body.recipient ?? body.from) as string | undefined;
  const text = (body.text ?? body.message_text) as string | undefined;
  const messageId = (body.message_id ?? body.id) as string | undefined;
  const attachments = extractAttachments(body);

  if (eventType === 'message_inbound' && (text || attachments.length > 0)) {
    // Owner vs contact: a reply from someone OTHER than the owner is a lead/contact
    // answering an agent-sent iMessage — route it to the unified Engagement inbox
    // (sms_messages, channel='imessage') and do NOT run the owner orchestrator.
    // We only divert when we can positively tell it's not the owner (owner phone
    // known AND different); otherwise we keep the existing owner-conversation path.
    const ownerPhone = await getTenantOwnerPhone();
    const normContact = contact ? normalizeToE164(contact) : null;
    const isContactReply = !!ownerPhone && !!normContact && normalizeToE164(ownerPhone) !== normContact;
    if (isContactReply) {
      await sql()`
        INSERT INTO public.sms_messages (tenant_id, direction, channel, message_sid, from_number, to_number, body, status)
        VALUES (
          ${tenantId()}, 'in', 'imessage', ${messageId ?? null}, ${normContact},
          ${process.env.LOOPMESSAGE_SENDER_NAME ?? 'imessage'}, ${String(text ?? '')}, 'received'
        )
      `;
      await createNotification({
        type: 'sms_inbound',
        severity: 'info',
        title: `New iMessage from ${contact}`,
        message: String(text ?? '').slice(0, 300),
        data: { from: contact, channel: 'imessage', message_id: messageId },
      });
      return NextResponse.json({ ok: true, captured: true, mode: 'contact_imessage' });
    }

    await sql()`
      INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, loop_message_id, status, metadata, attachments)
      VALUES (
        ${tenantId()}, 'in', ${contact ?? 'owner'},
        ${process.env.LOOPMESSAGE_SENDER_NAME ?? 'keyplayers'}, ${String(text ?? '')},
        ${messageId ?? null}, 'received', ${jsonb(body)},
        ${attachments.length > 0 ? jsonb(attachments) : null}
      )
    `;

    await createNotification({
      type: 'custom',
      severity: 'info',
      title: 'Owner iMessage',
      message: (String(text ?? '').slice(0, 200)) || `[${attachments.length} image${attachments.length === 1 ? '' : 's'}]`,
      data: { source: 'loopmessage', event: eventType, message_id: messageId, attachments: attachments.length },
    });

    const intent = text && attachments.length === 0 ? parseIntent(String(text)) : null;
    if (intent) {
      after(() => runWithTenant(ctx, async () => {
        try {
          const result = await executeIntent(intent);
          await sendIMessage(result.reply, { agent: 'keyplayer' });
        } catch (err) {
          console.error('[intent] failed:', (err as Error).message);
          await sendIMessage(`Something went wrong handling that: ${(err as Error).message}`, { agent: 'keyplayer' });
        }
      }));
      return NextResponse.json({ ok: true, captured: true, mode: 'intent', intent: intent.type });
    }

    after(() => runWithTenant(ctx, async () => {
      try {
        const result = await runOrchestrator();
        if (!result.ok) {
          console.error('[orchestrator] failed:', result.error);
          await sendIMessage(
            `I hit a snag and couldn't respond automatically: ${result.error.slice(0, 200)}. Try again, or check the dashboard logs.`,
            { agent: 'keyplayer' },
          );
          return;
        }
        const sendResult = await sendIMessage(result.text, { agent: 'keyplayer', metadata: { usage: result.usage } });
        if (!sendResult.ok) console.error('[orchestrator] reply send failed:', sendResult.error);
      } catch (err) {
        console.error('[orchestrator] unexpected:', err);
      }
    }));

    return NextResponse.json({ ok: true, captured: true, mode: 'orchestrator' });
  }

  if (eventType === 'message_sent' || eventType === 'message_failed') {
    if (messageId) {
      await sql()`
        UPDATE boardroom_messages
        SET status = ${eventType === 'message_sent' ? 'delivered' : 'failed'}
        WHERE loop_message_id = ${messageId} AND tenant_id = ${tenantId()}
      `;
    }
    return NextResponse.json({ ok: true, status_updated: true });
  }

  await sql()`
    INSERT INTO activity_log (tenant_id, ts, action, detail, result)
    VALUES (${tenantId()}, now(), 'loopmessage_event', ${JSON.stringify(body).slice(0, 1900)}, 'info')
  `;

  return NextResponse.json({ ok: true, ignored: eventType });
}
