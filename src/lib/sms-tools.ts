// SMS agent tool — sms_send via the tenant's connected Twilio account.
//
// Mirrors google-tools.ts. The tool is offered to an agent ONLY when Twilio is
// connected (smsAllowed); the connection itself is the opt-in, matching the
// loopmessage/agentmail messaging providers. Every send is audit-logged with the
// recipient masked. The handler never throws out of the tool-use loop.
//
// Wiring (see [[orchestrator-tool-wiring]]): SMS_TOOL_NAMES must be added in
// FOUR places for KeyPlayer — buildTools defs, CLIENT_TOOL_NAMES, the
// handleClientToolUse dispatch, and a prompt-awareness block — plus the
// subagent.ts filter + defs. Missing the CLIENT_TOOL_NAMES one yields
// "Orchestrator produced no text reply" and the tool silently never runs.

import Anthropic from '@anthropic-ai/sdk';
import { logAudit } from './audit';

export const SMS_TOOL_NAMES = ['sms_send'] as const;

/** True when this tenant has connected Twilio. The connection is the opt-in. */
export async function smsAllowed(): Promise<boolean> {
  try {
    const { isTwilioConnected } = await import('./twilio');
    return await isTwilioConnected();
  } catch {
    return false;
  }
}

export function smsToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'sms_send',
      description:
        'Send a REAL text message (SMS) via the connected Twilio account. This sends an ' +
        'actual text to the given phone number and costs money — use it only when the owner ' +
        'asked you to text someone, or for a genuine time-sensitive notification. The number ' +
        'must be E.164 format (e.g. +15551234567). Returns the Twilio message id on success.',
      input_schema: {
        type: 'object',
        required: ['to', 'body'],
        properties: {
          to: { type: 'string', description: 'Recipient phone number in E.164 format, e.g. +15551234567.' },
          body: { type: 'string', description: 'The text message content.' },
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
  const input = (toolUse.input ?? {}) as { to?: string; body?: string };
  const to = String(input.to ?? '').trim();
  const body = String(input.body ?? '').trim();
  if (!to || !body) {
    return { type: 'tool_result', tool_use_id: id, content: 'sms_send: both `to` and `body` are required.', is_error: true };
  }
  try {
    const { sendSms } = await import('./twilio');
    const r = await sendSms({ to, body });
    if (!r.sent) {
      return { type: 'tool_result', tool_use_id: id, content: `SMS not sent: ${r.reason}`, is_error: true };
    }
    // Audit the send — recipient masked, never the body or any secret.
    try {
      await logAudit({ actor: null, action: 'twilio.sms_send', target: mask(to), detail: { agent: sourceAgent, sid: r.sid, length: body.length } });
    } catch { /* best-effort */ }
    return { type: 'tool_result', tool_use_id: id, content: `SMS sent to ${mask(to)} (id: ${r.sid}).` };
  } catch (e) {
    return { type: 'tool_result', tool_use_id: id, content: `sms_send failed: ${(e as Error).message}`, is_error: true };
  }
}
