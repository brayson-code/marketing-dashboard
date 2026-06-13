import { after } from 'next/server';
import { sql, jsonb, tenantId } from './db/client';
import { sendTelegram, formatTelegramMessage, getTelegramConfig } from './telegram';

// Supabase-backed notification creator. Kept in its own module (free of any
// better-sqlite3 import) so serverless functions like the LoopMessage/Telegram
// webhooks can use it without dragging the native sqlite module into their bundle.

// Severities that are suppressed from Telegram to avoid noise.
// 'debug' is always skipped; all other levels ('info', 'warning', 'error') are
// forwarded so meaningful events get through without spamming dev-only diagnostics.
const TELEGRAM_SKIP_SEVERITIES = new Set(['debug']);

export async function createNotification(data: {
  type: string;
  severity?: string;
  title?: string;
  message: string;
  data?: Record<string, unknown>;
}): Promise<number> {
  const rows = await sql()`
    INSERT INTO notifications (tenant_id, type, severity, title, message, data)
    VALUES (
      ${tenantId()}, ${data.type}, ${data.severity || 'info'},
      ${data.title || null}, ${data.message}, ${data.data ? jsonb(data.data) : null}
    )
    RETURNING id
  `;
  const id = Number(rows[0].id);

  // Best-effort Telegram mirror. Never blocks or throws — a delivery failure
  // must not prevent the notification from being created.
  //
  // Gate: severity must not be in the skip set (drops 'debug').
  //       tenant must have telegram connected (getTelegramConfig checked inside sendTelegram).
  //       business_profile.telegram_notify !== false (default ON when connected).
  const severity = data.severity || 'info';
  if (!TELEGRAM_SKIP_SEVERITIES.has(severity)) {
    // Defer past the response so the fetch survives the serverless freeze.
    // after() only works inside a request scope; outside one (rare), fall back
    // to fire-and-forget. Either way this never blocks notification creation.
    try {
      after(() => mirrorToTelegram(data, severity));
    } catch {
      void mirrorToTelegram(data, severity);
    }
  }

  return id;
}

async function mirrorToTelegram(
  data: { type: string; severity?: string; title?: string; message: string },
  severity: string,
): Promise<void> {
  try {
    // Cheap connection guard FIRST — bail on the common (disconnected) path with
    // a single read, before touching the tenants table.
    const cfg = await getTelegramConfig();
    if (!cfg) return;

    // Check business_profile.telegram_notify flag (default ON — absence === true).
    const rows = (await sql()`
      SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
    const bp = rows[0]?.business_profile ?? {};
    // telegram_notify defaults to true (undefined → enabled); only false disables.
    if (bp.telegram_notify === false) return;

    const text = formatTelegramMessage({ title: data.title, message: data.message, severity });
    await sendTelegram(text);
  } catch (err) {
    console.warn('[notifications] telegram mirror failed:', (err as Error).message);
  }
}
