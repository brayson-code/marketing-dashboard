// Provider-agnostic outbound messaging — routes a message to the tenant's chosen
// provider (Twilio SMS or LoopMessage iMessage) with an optional auto-override to
// iMessage for contacts we know are reachable there.
//
// This is the CONTACT-messaging lane (writes to sms_messages, shows in the
// Engagement → SMS inbox). It is deliberately separate from loopmessage.ts's
// sendIMessage(), which is the owner↔agent Boardroom lane.
//
// Routing rules (resolveChannel):
//   • caller can force a channel ('sms' | 'imessage'); honored if connected
//   • only one provider connected → use it
//   • both connected → tenant default (business_profile.messaging_provider),
//     but if auto-route is on and the contact has texted us over iMessage before,
//     prefer iMessage
//
// The connection (Twilio creds / LoopMessage auth key) is the opt-in, same as the
// rest of the integrations. messagingAllowed() gates the agent `sms_send` tool.

import { sql, tenantId } from './db/client';
import { isTwilioConnected, sendSms, normalizeToE164 } from './twilio';
import { isLoopMessageConnected, sendIMessageToContact } from './loopmessage';

export type MessagingChannel = 'sms' | 'imessage';
export type MessagingProvider = 'twilio' | 'loopmessage';

export interface MessagingSettings {
  /** The tenant's default provider when both are connected. */
  provider: MessagingProvider;
  /** Prefer iMessage for contacts known to be iMessage-reachable. */
  autoRoute: boolean;
}

const DEFAULTS: MessagingSettings = { provider: 'twilio', autoRoute: true };

/** Read the tenant's messaging preferences from business_profile (with defaults). */
export async function getMessagingSettings(): Promise<MessagingSettings> {
  try {
    const rows = (await sql()`
      SELECT business_profile->>'messaging_provider' AS provider,
             business_profile->>'messaging_auto_route' AS auto
      FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ provider: string | null; auto: string | null }>;
    const r = rows[0];
    const provider: MessagingProvider = r?.provider === 'loopmessage' ? 'loopmessage' : 'twilio';
    const autoRoute = r?.auto == null || r.auto === '' ? DEFAULTS.autoRoute : r.auto === 'true';
    return { provider, autoRoute };
  } catch {
    return DEFAULTS;
  }
}

export interface ConnectedProviders { twilio: boolean; loopmessage: boolean }

export async function connectedProviders(): Promise<ConnectedProviders> {
  const [twilio, loopmessage] = await Promise.all([isTwilioConnected(), isLoopMessageConnected()]);
  return { twilio, loopmessage };
}

/** True when at least one messaging provider is connected — gates the agent tool. */
export async function messagingAllowed(): Promise<boolean> {
  const c = await connectedProviders();
  return c.twilio || c.loopmessage;
}

/** Have we ever received an iMessage from this contact? Then they're reachable on
 *  iMessage and auto-route can prefer it. Uses our own history — no extra API call. */
async function iMessageCapable(to: string): Promise<boolean> {
  try {
    const norm = normalizeToE164(to);
    const rows = (await sql()`
      SELECT 1 FROM public.sms_messages
      WHERE tenant_id = ${tenantId()} AND channel = 'imessage' AND direction = 'in'
        AND (from_number = ${norm} OR from_number = ${to})
      LIMIT 1
    `) as unknown as Array<Record<string, unknown>>;
    return rows.length > 0;
  } catch {
    return false;
  }
}

export interface ChannelDecision { channel: MessagingChannel | null; reason?: string }

/** Pick the channel for `to`, honoring a forced choice, connection state, the
 *  tenant default, and auto-route. */
export async function resolveChannel(to: string, forced: MessagingChannel | 'auto' = 'auto'): Promise<ChannelDecision> {
  const c = await connectedProviders();
  if (forced === 'sms') return c.twilio ? { channel: 'sms' } : { channel: null, reason: 'SMS (Twilio) is not connected for this workspace' };
  if (forced === 'imessage') return c.loopmessage ? { channel: 'imessage' } : { channel: null, reason: 'iMessage (LoopMessage) is not connected for this workspace' };

  if (!c.twilio && !c.loopmessage) return { channel: null, reason: 'no messaging provider is connected — connect Twilio or LoopMessage on the Connections page' };
  if (c.twilio && !c.loopmessage) return { channel: 'sms' };
  if (!c.twilio && c.loopmessage) return { channel: 'imessage' };

  // Both connected → tenant default, with auto-route override.
  const settings = await getMessagingSettings();
  if (settings.autoRoute && (await iMessageCapable(to))) return { channel: 'imessage' };
  return { channel: settings.provider === 'loopmessage' ? 'imessage' : 'sms' };
}

export interface MessagingResult { sent: boolean; sid?: string; channel?: MessagingChannel; reason?: string }

/** Send a message to a contact over whichever channel resolveChannel() picks.
 *  Both providers record to sms_messages (the unified inbox). Never throws. */
export async function sendMessage(opts: { to: string; body: string; channel?: MessagingChannel | 'auto' }): Promise<MessagingResult> {
  const { channel, reason } = await resolveChannel(opts.to, opts.channel ?? 'auto');
  if (!channel) return { sent: false, reason };
  if (channel === 'imessage') {
    const r = await sendIMessageToContact({ to: opts.to, body: opts.body });
    return { sent: r.sent, sid: r.sid, reason: r.reason, channel: 'imessage' };
  }
  const r = await sendSms({ to: opts.to, body: opts.body });
  return { sent: r.sent, sid: r.sid, reason: r.reason, channel: 'sms' };
}
