import { sql, jsonb, tenantId } from './db/client';

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

export async function sendIMessage(text: string, opts: SendIMessageOptions = {}): Promise<SendIMessageResult> {
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
