import { NextResponse, after } from 'next/server';
import { sql, jsonb, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { createNotification } from '@/lib/notifications';
import { runOrchestrator } from '@/lib/orchestrator';
import { sendIMessage } from '@/lib/loopmessage';
import { parseIntent, executeIntent } from '@/lib/intents';
import type { Attachment } from '@/lib/vision';

// LoopMessage delivers MMS media in a few shapes depending on the integration:
// an `attachments` array of URLs or objects, or singular media_url/attachment_url
// fields. Normalize whatever is present into our Attachment shape so KeyPlayer
// can "see" texted images. We keep the LoopMessage URL directly — the orchestrator
// downloads it at reply time (the URL is still fresh since we run immediately).
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
  // Singular fallbacks some LoopMessage configs send.
  push(body.media_url, body.media_type);
  push(body.attachment_url, body.attachment_type);

  // De-dupe by URL.
  const seen = new Set<string>();
  return out.filter((a) => (seen.has(a.url) ? false : (seen.add(a.url), true)));
}

// LoopMessage inbound webhook.
// Payload reference: https://docs.loopmessage.com/imessage-conversation-api/webhook
// Common alert_types: message_inbound, message_sent, message_failed, message_reaction,
// message_timeout, conversation_inited, group_created, group_changed.
//
// Auth: LoopMessage's webhook config lets you define a custom header value that
// it sends on every hit. We compare it constant-time against LOOPMESSAGE_WEBHOOK_SECRET.
// If the secret is unset, the check is skipped (dev convenience — set it before client launch).
function isAuthorized(request: Request): boolean {
  const expected = process.env.LOOPMESSAGE_WEBHOOK_SECRET?.trim();
  if (!expected) return true;
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

export async function POST(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized webhook' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // LoopMessage uses `event` (not `alert_type`) and `contact` for the user's phone.
  const eventType = typeof body.event === 'string' ? body.event : (typeof body.alert_type === 'string' ? body.alert_type : 'unknown');
  const contact = (body.contact ?? body.recipient ?? body.from) as string | undefined;
  const text = (body.text ?? body.message_text) as string | undefined;
  const messageId = (body.message_id ?? body.id) as string | undefined;
  const attachments = extractAttachments(body);

  // Inbound counts if there's text OR media (image-only MMS is valid).
  if (eventType === 'message_inbound' && (text || attachments.length > 0)) {
    await sql()`
      INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, loop_message_id, status, metadata, attachments)
      VALUES (
        ${DEFAULT_TENANT_ID}, 'in', ${contact ?? 'owner'},
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

    // Try fast-path intent first (approve / reject / publish / send / list / help).
    // If matched, execute deterministically and reply in < 1s without burning a Claude call.
    // Skip the fast path entirely for image-bearing messages — those always need
    // the orchestrator's vision to interpret what was sent.
    const intent = text && attachments.length === 0 ? parseIntent(String(text)) : null;
    if (intent) {
      // after() keeps the serverless function alive until this completes,
      // so the reply is actually sent (a bare detached promise can be killed).
      after(async () => {
        try {
          const result = await executeIntent(intent);
          await sendIMessage(result.reply, { agent: 'keyplayer' });
        } catch (err) {
          console.error('[intent] failed:', (err as Error).message);
          await sendIMessage(`Something went wrong handling that: ${(err as Error).message}`, { agent: 'keyplayer' });
        }
      });
      return NextResponse.json({ ok: true, captured: true, mode: 'intent', intent: intent.type });
    }

    // Fall through: full orchestrator dispatch for free-form conversation.
    // after() lets LoopMessage get a fast ack while the (slow) Claude run finishes
    // in the same invocation. For very long multi-agent runs, move to Vercel Queues.
    after(async () => {
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
        const sendResult = await sendIMessage(result.text, { agent: 'keyplayer' });
        if (!sendResult.ok) {
          console.error('[orchestrator] reply send failed:', sendResult.error);
        }
      } catch (err) {
        console.error('[orchestrator] unexpected:', err);
      }
    });

    return NextResponse.json({ ok: true, captured: true, mode: 'orchestrator' });
  }

  if (eventType === 'message_sent' || eventType === 'message_failed') {
    if (messageId) {
      await sql()`
        UPDATE boardroom_messages
        SET status = ${eventType === 'message_sent' ? 'delivered' : 'failed'}
        WHERE loop_message_id = ${messageId} AND tenant_id = ${DEFAULT_TENANT_ID}
      `;
    }
    return NextResponse.json({ ok: true, status_updated: true });
  }

  // Anything else: log raw payload so we can see field shape.
  await sql()`
    INSERT INTO activity_log (tenant_id, ts, action, detail, result)
    VALUES (${DEFAULT_TENANT_ID}, now(), 'loopmessage_event', ${JSON.stringify(body).slice(0, 1900)}, 'info')
  `;

  return NextResponse.json({ ok: true, ignored: eventType });
}
