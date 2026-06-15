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
import { sql, tenantId } from './db/client';

export interface TwilioConfig {
  account_sid: string;
  auth_token: string;
  from_number: string;
}

// Default daily outbound SMS cap per workspace (overridable via
// business_profile.sms_daily_limit). Guards against a runaway agent texting in a
// loop and racking up Twilio charges. Set to 0 to disable the cap.
const DEFAULT_SMS_DAILY_LIMIT = 50;

/** The tenant's daily SMS send limit (business_profile.sms_daily_limit, else default). */
async function smsDailyLimit(): Promise<number> {
  try {
    const rows = (await sql()`
      SELECT (business_profile->>'sms_daily_limit') AS lim FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ lim: string | null }>;
    const v = rows[0]?.lim;
    if (v == null || v === '') return DEFAULT_SMS_DAILY_LIMIT;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_SMS_DAILY_LIMIT;
  } catch {
    return DEFAULT_SMS_DAILY_LIMIT;
  }
}

/** Count of outbound SMS sent today (UTC) for this tenant. */
async function sentToday(): Promise<number> {
  const rows = (await sql()`
    SELECT count(*)::int AS n FROM public.sms_messages
    WHERE tenant_id = ${tenantId()} AND direction = 'out'
      AND created_at >= date_trunc('day', now() at time zone 'utc')
  `) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
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

/**
 * Best-effort normalisation of a loosely-formatted phone number to E.164.
 * Strips spaces, dashes, parentheses, and dots first, then applies rules:
 *   • already starts with +  → keep as-is
 *   • starts with 00         → replace 00 prefix with +
 *   • exactly 10 digits      → assume US (+1 prefix)
 *   • 11 digits starting 1   → prefix with +
 *   • anything else          → return unchanged (E164 validator will reject)
 */
export function normalizeToE164(input: string): string {
  // Strip whitespace and common formatting characters.
  const stripped = input.replace(/[\s\-().]/g, '');
  if (stripped.startsWith('+')) return stripped;
  if (stripped.startsWith('00')) return `+${stripped.slice(2)}`;
  if (/^\d{10}$/.test(stripped)) return `+1${stripped}`;
  if (/^1\d{10}$/.test(stripped)) return `+${stripped}`;
  return stripped;
}

/** Send an SMS via the tenant's Twilio account. Never throws — a failure is a
 *  normal { sent:false, reason } outcome. The auth token is never logged. */
export async function sendSms(opts: { to: string; body: string }): Promise<SendSmsResult> {
  const to = normalizeToE164((opts.to ?? '').trim());
  const body = (opts.body ?? '').trim();
  if (!E164.test(to)) {
    return { sent: false, reason: `recipient "${opts.to?.trim()}" could not be normalised to a valid E.164 phone number (e.g. +15551234567 or (415) 555-0123)` };
  }
  if (!body) return { sent: false, reason: 'message body is empty' };

  const cfg = await getTwilioConfig();
  if (!cfg) return { sent: false, reason: 'Twilio is not connected for this workspace' };

  // Per-day cap — a runaway loop can't run up the Twilio bill. 0 = disabled.
  const limit = await smsDailyLimit();
  if (limit > 0) {
    const used = await sentToday().catch(() => 0);
    if (used >= limit) {
      return { sent: false, reason: `daily SMS limit reached (${used}/${limit}) — raise it in Settings or wait until tomorrow (UTC)` };
    }
  }

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
    if (res.ok && data.sid) {
      // Record the outbound for history + the daily-limit count. Best-effort.
      try {
        await sql()`
          INSERT INTO public.sms_messages (tenant_id, direction, channel, message_sid, from_number, to_number, body, status)
          VALUES (${tenantId()}, 'out', 'sms', ${data.sid}, ${cfg.from_number}, ${to}, ${body}, ${'sent'})
        `;
      } catch { /* non-blocking */ }
      return { sent: true, sid: data.sid };
    }
    // Twilio puts the human cause in `message` — surface it without the token.
    return { sent: false, reason: data.message || `Twilio error (HTTP ${res.status})` };
  } catch (e) {
    return { sent: false, reason: `Twilio unreachable — ${(e as Error).message}` };
  }
}
