// Messaging agent tool — sms_send routes to the tenant's chosen provider
// (Twilio SMS or LoopMessage iMessage) via the provider router (src/lib/messaging.ts).
//
// Mirrors google-tools.ts. The tool is offered to an agent ONLY when at least one
// provider is connected (smsAllowed → messagingAllowed); the connection itself is
// the opt-in. Every send is audit-logged with the recipient masked. The handler
// never throws out of the tool-use loop.
//
// Wiring (see [[orchestrator-tool-wiring]]): SMS_TOOL_NAMES must be added in
// FOUR places for KeyPlayer — buildTools defs, CLIENT_TOOL_NAMES, the
// handleClientToolUse dispatch, and a prompt-awareness block — plus the
// subagent.ts filter + defs. Missing the CLIENT_TOOL_NAMES one yields
// "Orchestrator produced no text reply" and the tool silently never runs.
// The tool NAME stays `sms_send` for backward-compat even though it now also
// sends iMessage.

import Anthropic from '@anthropic-ai/sdk';
import { logAudit } from './audit';

export const SMS_TOOL_NAMES = ['sms_send'] as const;

/** True when this tenant has connected a messaging provider (Twilio or LoopMessage).
 *  The connection is the opt-in. */
export async function smsAllowed(): Promise<boolean> {
  try {
    const { messagingAllowed } = await import('./messaging');
    return await messagingAllowed();
  } catch {
    return false;
  }
}

export function smsToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'sms_send',
      description:
        'Send a REAL text message to a contact. It goes out over the workspace’s connected ' +
        'messaging provider — Twilio SMS and/or LoopMessage iMessage — and costs money, so use ' +
        'it only when the owner asked you to text someone or for a genuine time-sensitive ' +
        'notification. By default the channel is chosen automatically (the workspace’s ' +
        'preferred provider, preferring iMessage for contacts known to be on iMessage); you ' +
        'normally do NOT set `channel`. Accepts common phone number formats (e.g. (415) 555-0123, ' +
        '415-555-0123, 14155550123) and normalises them to E.164. Returns the message id and the ' +
        'channel used on success.',
      input_schema: {
        type: 'object',
        required: ['to', 'body'],
        properties: {
          to: { type: 'string', description: 'Recipient phone number. Accepts common formats such as (415) 555-0123, 415-555-0123, +14155550123, or 14155550123 — automatically normalised to E.164.' },
          body: { type: 'string', description: 'The message content.' },
          channel: { type: 'string', enum: ['auto', 'sms', 'imessage'], description: "Optional delivery channel. Leave unset (or 'auto') to use the workspace's preference. Only set 'sms' or 'imessage' to force a specific channel." },
        },
      },
    },
  ];
}

function mask(phone: string): string {
  const p = (phone || '').trim();
  return p.length > 4 ? `…${p.slice(-4)}` : p;
}

export async function handleSmsTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent: string,
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  if (toolUse.name !== 'sms_send') {
    return { type: 'tool_result', tool_use_id: id, content: `Unknown SMS tool: ${toolUse.name}`, is_error: true };
  }
  const input = (toolUse.input ?? {}) as { to?: string; body?: string; channel?: string };
  const to = String(input.to ?? '').trim();
  const body = String(input.body ?? '').trim();
  const channel = input.channel === 'sms' || input.channel === 'imessage' ? input.channel : 'auto';
  if (!to || !body) {
    return { type: 'tool_result', tool_use_id: id, content: 'sms_send: both `to` and `body` are required.', is_error: true };
  }
  try {
    const { sendMessage } = await import('./messaging');
    const r = await sendMessage({ to, body, channel });
    if (!r.sent) {
      return { type: 'tool_result', tool_use_id: id, content: `Message not sent: ${r.reason}`, is_error: true };
    }
    const label = r.channel === 'imessage' ? 'iMessage' : 'SMS';
    // Audit the send — recipient masked, never the body or any secret.
    try {
      await logAudit({ actor: null, action: 'messaging.send', target: mask(to), detail: { agent: sourceAgent, sid: r.sid, channel: r.channel, length: body.length } });
    } catch { /* best-effort */ }
    return { type: 'tool_result', tool_use_id: id, content: `${label} sent to ${mask(to)} (id: ${r.sid}).` };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: id, content: `sms_send failed: ${(e as Error).message}`, is_error: true };
  }
}
