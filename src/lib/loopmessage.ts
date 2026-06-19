import { sql, jsonb, tenantId } from './db/client';
import { DEFAULT_TENANT_ID } from './tenant';
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

/** The phone number the orchestrator texts for THIS workspace's owner (the
 *  owner↔agent lane). Per-tenant — set on the LoopMessage connection as
 *  `owner_phone`. The env KEYPLAYERS_OWNER_PHONE is the HQ owner's cell and is a
 *  fallback for HQ/dev ONLY: a client must never inherit HQ's number, or the
 *  agent texts the wrong phone (and the client's sandbox rejects it). */
export async function getTenantOwnerPhone(): Promise<string | null> {
  try {
    const row = await getIntegration('loopmessage');
    const p = (row?.config as { owner_phone?: string } | undefined)?.owner_phone?.trim();
    if (p) return p;
  } catch { /* fall through to env (HQ only) */ }
  const isHqOrDev = tenantId() === DEFAULT_TENANT_ID || process.env.NODE_ENV !== 'production';
  return isHqOrDev ? (process.env.KEYPLAYERS_OWNER_PHONE?.trim() || null) : null;
}

/** The number to SHOW in the Boardroom badge for the active tenant. The env
 *  KEYPLAYERS_OWNER_PHONE is the HQ owner's personal cell (owner↔agent lane) — it
 *  must NEVER be shown to client workspaces. A client sees its own connected
 *  messaging number (Twilio/LoopMessage), or null if it hasn't connected one. */
export async function getBoardroomBadgePhone(): Promise<string | null> {
  const isHqOrDev = tenantId() === DEFAULT_TENANT_ID || process.env.NODE_ENV !== 'production';
  if (isHqOrDev) {
    const env = getOwnerPhone();
    if (env) return env;
  }
  // Display-only: read the connected sending number. `from_number` is a text field
  // stored in the integration's `config` jsonb (not the encrypted secret), so we can
  // show it without decryption and without needing the full Twilio credential set.
  try {
    const row = await getIntegration('twilio');
    const from = (row?.config as { from_number?: string } | undefined)?.from_number?.trim();
    if (from) return from;
  } catch { /* no connected number */ }
  return null;
}

export function isLoopMessageConfigured(): boolean {
  return !!process.env.LOOPMESSAGE_AUTH_KEY;
}

export async function sendIMessage(rawText: string, opts: SendIMessageOptions = {}): Promise<SendIMessageResult> {
  // iMessage/SMS can't render markdown — flatten to clean plaintext here, the
  // single chokepoint, so every caller's reply lands readable (not raw **md**).
  const text = mdToPlainText(rawText);
  // Per-tenant creds: a client's orchestrator must send through ITS OWN LoopMessage
  // account to ITS OWN owner phone — never the HQ env account (that's the bug that
  // made a client's replies vanish / fail with "invalid sender"). getLoopMessageConfig
  // already falls back to the env account for HQ/dev only.
  const cfg = await getLoopMessageConfig();
  const authKey = cfg?.auth_key;
  const senderName = opts.sender ?? cfg?.sender_name;
  const recipient = opts.recipient ?? (await getTenantOwnerPhone());

  if (!authKey) return { ok: false, error: 'LoopMessage isn’t connected for this workspace.' };
  if (!recipient) return { ok: false, error: 'No recipient — add your phone number on the LoopMessage connection (Connections → LoopMessage → “Your phone”).' };

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

/**
 * PLATFORM security-alert iMessage. Unlike sendIMessage() (tenant-scoped), this ALWAYS
 * uses the HQ env LoopMessage account (LOOPMESSAGE_AUTH_KEY) to text the platform owner
 * (KEYPLAYERS_OWNER_PHONE), independent of the current tenant. Security events fire in
 * the OFFENDING tenant's request context, but the alert must reach the OPERATOR no
 * matter which workspace it came from — so this bypasses getLoopMessageConfig()/the
 * per-tenant recipient. Best-effort (caller swallows); no boardroom_messages write
 * (alerts aren't a tenant's boardroom lane).
 */
export async function sendPlatformAlertIMessage(rawText: string): Promise<SendIMessageResult> {
  const authKey = process.env.LOOPMESSAGE_AUTH_KEY?.trim();
  const recipient = process.env.KEYPLAYERS_OWNER_PHONE?.trim();
  if (!authKey) return { ok: false, error: 'platform LoopMessage not configured (LOOPMESSAGE_AUTH_KEY)' };
  if (!recipient) return { ok: false, error: 'no platform owner phone (KEYPLAYERS_OWNER_PHONE)' };

  const body: Record<string, unknown> = { contact: recipient, text: mdToPlainText(rawText) };
  const senderName = process.env.LOOPMESSAGE_SENDER_NAME?.trim();
  if (senderName) body.sender_name = senderName;

  try {
    const res = await fetch(SEND_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authKey },
      body: JSON.stringify(body),
    });
    const respText = await res.text();
    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(respText); } catch { /* keep empty */ }
    if (!res.ok) {
      return { ok: false, error: (parsed.message as string) || respText.slice(0, 200) || `HTTP ${res.status}`, status: res.status };
    }
    return { ok: true, messageId: (parsed.message_id as string) || (parsed.id as string) || `loop-${Date.now()}`, status: parsed.status as string | undefined };
  } catch (err) {
    return { ok: false, error: `network: ${(err as Error).message}` };
  }
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
  // The platform env creds (LOOPMESSAGE_*) are the HQ owner's OWN LoopMessage
  // account. They must NEVER leak into a client workspace's send — pairing HQ's
  // sender_name with a client's auth_key (or vice-versa) is exactly what triggers
  // LoopMessage's "invalid or unable to use this sender name". So env is a fallback
  // for HQ/dev only; a client uses strictly its own connected creds.
  const isHqOrDev = tenantId() === DEFAULT_TENANT_ID || process.env.NODE_ENV !== 'production';
  try {
    // password-typed fields (auth_key) live in the encrypted secret; text fields
    // (sender_name) live in the integration's `config` jsonb — read both.
    const [s, row] = await Promise.all([
      getDecryptedSecret('loopmessage') as Promise<Partial<{ auth_key: string; sender_name: string }> | null>,
      getIntegration('loopmessage'),
    ]);
    const cfg = (row?.config ?? {}) as Partial<{ sender_name: string }>;
    const authKey = s?.auth_key?.trim();
    const senderName = s?.sender_name?.trim() || cfg.sender_name?.trim() || (isHqOrDev ? process.env.LOOPMESSAGE_SENDER_NAME : undefined);
    if (authKey) return { auth_key: authKey, sender_name: senderName };
  } catch {
    /* fall through to env */
  }
  const envKey = isHqOrDev ? process.env.LOOPMESSAGE_AUTH_KEY?.trim() : undefined;
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
