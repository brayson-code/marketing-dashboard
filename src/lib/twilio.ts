// Twilio SMS — per-tenant BYO-account outbound texting.
//
// Each tenant pastes their own Twilio Account SID + Auth Token + a From number
// (or Messaging Service SID) on the Connections page (provider 'twilio'), stored
// AES-encrypted via integrations-store. Agents send SMS through the tenant's own
// Twilio account, so the cost + sender identity stay with them.
//
// Plain fetch against the Twilio REST API (no SDK). The auth token is used only
// to build the Basic-auth header and is NEVER logged.

import { getDecryptedSecret } from './integrations-store';

export interface TwilioConfig {
  account_sid: string;
  auth_token: string;
  from_number: string;
}

export interface SendSmsResult {
  sent: boolean;
  sid?: string;
  reason?: string;
}

/** This tenant's stored Twilio credentials, or null when not connected. */
export async function getTwilioConfig(): Promise<TwilioConfig | null> {
  try {
    const s = (await getDecryptedSecret('twilio')) as Partial<TwilioConfig> | null;
    const account_sid = s?.account_sid?.trim();
    const auth_token = s?.auth_token?.trim();
    const from_number = s?.from_number?.trim();
    if (!account_sid || !auth_token || !from_number) return null;
    return { account_sid, auth_token, from_number };
  } catch {
    return null;
  }
}

/** Cheap connection check — no API call. */
export async function isTwilioConnected(): Promise<boolean> {
  return (await getTwilioConfig()) !== null;
}

const E164 = /^\+[1-9]\d{6,14}$/;

/** Send an SMS via the tenant's Twilio account. Never throws — a failure is a
 *  normal { sent:false, reason } outcome. The auth token is never logged. */
export async function sendSms(opts: { to: string; body: string }): Promise<SendSmsResult> {
  const to = (opts.to ?? '').trim();
  const body = (opts.body ?? '').trim();
  if (!E164.test(to)) {
    return { sent: false, reason: `recipient "${to}" is not a valid E.164 phone number (e.g. +15551234567)` };
  }
  if (!body) return { sent: false, reason: 'message body is empty' };

  const cfg = await getTwilioConfig();
  if (!cfg) return { sent: false, reason: 'Twilio is not connected for this workspace' };

  // Messaging Service SIDs start with 'MG' and go in MessagingServiceSid; a bare
  // phone number goes in From.
  const isMessagingService = /^MG[0-9a-f]{32}$/i.test(cfg.from_number);
  const form = new URLSearchParams();
  form.set('To', to);
  form.set('Body', body);
  if (isMessagingService) form.set('MessagingServiceSid', cfg.from_number);
  else form.set('From', cfg.from_number);

  const auth = Buffer.from(`${cfg.account_sid}:${cfg.auth_token}`).toString('base64');

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.account_sid)}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form.toString(),
      },
    );
    const data = (await res.json().catch(() => ({}))) as { sid?: string; message?: string; code?: number };
    if (res.ok && data.sid) return { sent: true, sid: data.sid };
    // Twilio puts the human cause in `message` — surface it without the token.
    return { sent: false, reason: data.message || `Twilio error (HTTP ${res.status})` };
  } catch (e) {
    return { sent: false, reason: `Twilio unreachable — ${(e as Error).message}` };
  }
}
