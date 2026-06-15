import { createHmac, timingSafeEqual } from 'node:crypto';
import { sql, tenantId } from '@/lib/db/client';
import { createNotification } from '@/lib/notifications';
import { getTwilioConfig } from '@/lib/twilio';

// Inbound Twilio SMS handler. Mounted per-tenant at
// /api/webhook/twilio/[tenantId] and run inside runWithTenant, so every write
// lands in the right workspace. Stores the message in sms_messages (NOT
// boardroom_messages — it surfaces in the Engagement inbox, not the Boardroom)
// and fires a notification (which mirrors to Telegram if connected).

/** Verify Twilio's X-Twilio-Signature: base64(HMAC-SHA1(authToken, url + sorted
 *  param key+value pairs)). The URL must be the exact public webhook URL Twilio
 *  called — reconstructed from the forwarded host/proto. Timing-safe compare. */
function verifyTwilioSignature(opts: {
  signature: string | null;
  url: string;
  params: Record<string, string>;
  authToken: string;
}): boolean {
  const { signature, url, params, authToken } = opts;
  if (!signature) return false;
  const data = Object.keys(params)
    .sort()
    .reduce((acc, k) => acc + k + params[k], url);
  const expected = createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Public URL Twilio signed against — proto + host from the proxy headers + path. */
function publicUrl(request: Request, pathWithQuery: string): string {
  const h = request.headers;
  const proto = h.get('x-forwarded-proto') || 'https';
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  return `${proto}://${host}${pathWithQuery}`;
}

export interface TwilioInboundResult { ok: boolean; status: number; reason?: string }

/** Handle one inbound Twilio webhook hit. Caller has already entered the tenant
 *  context (runWithTenant), so tenantId() is the recipient workspace. */
export async function handleTwilioInbound(request: Request, rawPath: string): Promise<TwilioInboundResult> {
  const cfg = await getTwilioConfig();
  if (!cfg) return { ok: false, status: 403, reason: 'twilio not connected for this tenant' };

  // Twilio posts application/x-www-form-urlencoded.
  const bodyText = await request.text();
  const form = new URLSearchParams(bodyText);
  const params: Record<string, string> = {};
  for (const [k, v] of form.entries()) params[k] = v;

  const ok = verifyTwilioSignature({
    signature: request.headers.get('x-twilio-signature'),
    url: publicUrl(request, rawPath),
    params,
    authToken: cfg.auth_token,
  });
  if (!ok) return { ok: false, status: 401, reason: 'invalid twilio signature' };

  const from = params.From ?? null;
  const to = params.To ?? null;
  const text = params.Body ?? '';
  const sid = params.MessageSid ?? params.SmsSid ?? null;

  // Store the inbound message (Engagement inbox reads this).
  try {
    await sql()`
      INSERT INTO public.sms_messages (tenant_id, direction, message_sid, from_number, to_number, body, status)
      VALUES (${tenantId()}, 'in', ${sid}, ${from}, ${to}, ${text}, ${'received'})
    `;
  } catch {
    return { ok: false, status: 500, reason: 'store failed' };
  }

  // Notify the owner (also mirrors to Telegram when connected). Best-effort.
  await createNotification({
    type: 'sms_inbound',
    severity: 'info',
    title: `New SMS from ${from ?? 'unknown'}`,
    message: text.slice(0, 300),
    data: { from, to, sid },
  }).catch(() => {});

  return { ok: true, status: 200 };
}
