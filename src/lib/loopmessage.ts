import { sql, jsonb, tenantId } from './db/client';
import { mdToPlainText } from './md-to-text';
import { getDecryptedSecret, getIntegration } from './integrations-store';

const SEND_URL = 'https://a.loopmessage.com/api/v1/message/send/';

export type SendIMessageResult =
  | { ok: true; messageId: string; status?: string }
  | { ok: false; error: string; status?: number };

export interface SendIMessageOptions {
  recipient?: string;
  sender?: string;
  service?: 'iMessage' | 'SMS';
  metadata?: Record<string, unknown>;
  agent?: string;
}

export function getOwnerPhone(): string | null {
  return process.env.KEYPLAYERS_OWNER_PHONE?.trim() || null;
}

export function isLoopMessageConfigured(): boolean {
  return !!process.env.LOOPMESSAGE_AUTH_KEY;
}

export async function sendIMessage(rawText: string, opts: SendIMessageOptions = {}): Promise<SendIMessageResult> {
  // iMessage/SMS can't render markdown — flatten to clean plaintext here, the
  // single chokepoint, so every caller's reply lands readable (not raw **md**).
  const text = mdToPlainText(rawText);
  const authKey = process.env.LOOPMESSAGE_AUTH_KEY;
  const senderName = opts.sender ?? process.env.LOOPMESSAGE_SENDER_NAME;
  const recipient = opts.recipient ?? getOwnerPhone();

  if (!authKey) return { ok: false, error: 'LOOPMESSAGE_AUTH_KEY not configured' };
  if (!recipient) return { ok: false, error: 'No recipient (set KEYPLAYERS_OWNER_PHONE or pass opts.recipient)' };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: authKey,
  };

  const body: Record<string, unknown> = { contact: recipient, text };
  if (senderName) body.sender_name = senderName;

  let res: Response;
  try {
    res = await fetch(SEND_URL, { method: 'POST', headers, body: JSON.stringify(body) });
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }

  const respText = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(respText); } catch { /* keep empty */ }

  if (!res.ok) {
    return { ok: false, error: parsed.message as string || respText.slice(0, 200) || `HTTP ${res.status}`, status: res.status };
  }

  const messageId = (parsed.message_id as string) || (parsed.id as string) || `loop-${Date.now()}`;
  const status = parsed.status as string | undefined;

  await sql()`
    INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, loop_message_id, status, metadata)
    VALUES (
      ${tenantId()}, 'out', ${opts.agent ?? 'system'}, ${recipient}, ${text},
      ${messageId}, ${status ?? 'sent'}, ${opts.metadata ? jsonb(opts.metadata) : null}
    )
  `;

  return { ok: true, messageId, status };
}

// ─── Per-tenant connection + contact messaging ────────────────────────────────
// The above sendIMessage() is the owner↔agent Boardroom lane (env-keyed, HQ).
// The below is the CONTACT-messaging lane used by the provider router
// (src/lib/messaging.ts): per-tenant LoopMessage creds, recorded to sms_messages
// so iMessage threads show up in the same Engagement inbox as SMS.

export interface LoopMessageConfig { auth_key: string; sender_name?: string }

/** This tenant's LoopMessage credentials — its own connection first, HQ env as a
 *  fallback (so the platform owner's account still works without a tenant row). */
export async function getLoopMessageConfig(): Promise<LoopMessageConfig | null> {
  try {
    // password-typed fields (auth_key) live in the encrypted secret; text fields
    // (sender_name) live in the integration's `config` jsonb — read both.
    const [s, row] = await Promise.all([
      getDecryptedSecret('loopmessage') as Promise<Partial<{ auth_key: string; sender_name: string }> | null>,
      getIntegration('loopmessage'),
    ]);
    const cfg = (row?.config ?? {}) as Partial<{ sender_name: string }>;
    const authKey = s?.auth_key?.trim();
    const senderName = s?.sender_name?.trim() || cfg.sender_name?.trim() || process.env.LOOPMESSAGE_SENDER_NAME;
    if (authKey) return { auth_key: authKey, sender_name: senderName };
  } catch {
    /* fall through to env */
  }
  const envKey = process.env.LOOPMESSAGE_AUTH_KEY?.trim();
  if (envKey) return { auth_key: envKey, sender_name: process.env.LOOPMESSAGE_SENDER_NAME };
  return null;
}

/** Cheap connection check — no API call. */
export async function isLoopMessageConnected(): Promise<boolean> {
  return (await getLoopMessageConfig()) !== null;
}

export interface SendContactResult { sent: boolean; sid?: string; reason?: string }

/** Send an iMessage to an arbitrary contact and record it to the unified
 *  sms_messages inbox (channel='imessage'). Never throws — a failure is a normal
 *  { sent:false, reason } outcome. */
export async function sendIMessageToContact(opts: { to: string; body: string }): Promise<SendContactResult> {
  const to = (opts.to ?? '').trim();
  const text = mdToPlainText((opts.body ?? '').trim());
  if (!to) return { sent: false, reason: 'recipient is empty' };
  if (!text) return { sent: false, reason: 'message body is empty' };

  const cfg = await getLoopMessageConfig();
  if (!cfg) return { sent: false, reason: 'iMessage (LoopMessage) is not connected for this workspace' };

  const payload: Record<string, unknown> = { contact: to, text };
  if (cfg.sender_name) payload.sender_name = cfg.sender_name;

  let res: Response;
  try {
    res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: cfg.auth_key },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    return { sent: false, reason: `LoopMessage unreachable — ${(err as Error).message}` };
  }

  const respText = await res.text();
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(respText); } catch { /* keep empty */ }
  if (!res.ok) {
    return { sent: false, reason: (parsed.message as string) || respText.slice(0, 200) || `LoopMessage error (HTTP ${res.status})` };
  }

  const messageId = (parsed.message_id as string) || (parsed.id as string) || `loop-${Date.now()}`;
  try {
    await sql()`
      INSERT INTO public.sms_messages (tenant_id, direction, channel, message_sid, from_number, to_number, body, status)
      VALUES (${tenantId()}, 'out', 'imessage', ${messageId}, ${cfg.sender_name ?? 'imessage'}, ${to}, ${text}, ${(parsed.status as string) ?? 'sent'})
    `;
  } catch { /* non-blocking */ }

  return { sent: true, sid: messageId };
}
