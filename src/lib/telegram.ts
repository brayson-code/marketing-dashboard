// Telegram outbound notifications — sends Command Center alerts to the tenant's
// Telegram bot. Connection is BYO-key (bot_token + chat_id stored in
// client_integrations under provider='telegram'). Always best-effort: if
// Telegram is not connected or the API call fails, we log a warning and return
// a non-throwing result — callers must never depend on delivery succeeding.
//
// Usage: sendTelegram(text) from any server-side code. Called automatically by
// createNotification() when the tenant has the integration connected.

import { getDecryptedSecret } from './integrations-store';

const TELEGRAM_API = 'https://api.telegram.org';

// ── Types ────────────────────────────────────────────────────────────────────

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

export type SendTelegramResult =
  | { sent: true }
  | { sent: false; reason: string };

export interface SendTelegramOptions {
  /** Override parse_mode (default: 'HTML'). */
  parse_mode?: 'HTML' | 'Markdown' | 'MarkdownV2';
  /** Disable link previews (default: true). */
  disable_web_page_preview?: boolean;
}

// ── Config helpers ───────────────────────────────────────────────────────────

/**
 * Read the tenant's stored Telegram credentials. Returns null when the
 * integration is not yet connected (no DB row or incomplete fields).
 */
export async function getTelegramConfig(): Promise<TelegramConfig | null> {
  const secret = await getDecryptedSecret('telegram');
  if (!secret) return null;
  const { bot_token, chat_id } = secret;
  if (!bot_token || !chat_id) return null;
  return { bot_token, chat_id };
}

/** Quick boolean: is Telegram wired up for the active tenant? */
export async function isTelegramConnected(): Promise<boolean> {
  const cfg = await getTelegramConfig();
  return cfg !== null;
}

// ── Message formatting ───────────────────────────────────────────────────────

/**
 * Build a concise HTML-formatted Telegram message from a notification-shaped
 * object. Public so it can be unit-tested without DB access.
 *
 * Format:
 *   <b>Title</b> (when present)
 *   Body text — truncated to 500 chars to keep messages scannable.
 */
export function formatTelegramMessage(notification: {
  title?: string | null;
  message: string;
  severity?: string;
}): string {
  const { title, message, severity } = notification;

  // Severity prefix icon (Telegram-readable via HTML — no emoji for 'info').
  const icon =
    severity === 'error' ? '🔴 ' :
    severity === 'warning' ? '🟡 ' :
    '';

  const lines: string[] = [];
  if (title) {
    lines.push(`${icon}<b>${escapeHtml(title)}</b>`);
    lines.push(escapeHtml(truncate(message, 500)));
  } else {
    lines.push(`${icon}${escapeHtml(truncate(message, 500))}`);
  }

  return lines.join('\n');
}

// ── Send ─────────────────────────────────────────────────────────────────────

/**
 * Post `text` to the tenant's Telegram chat. Never throws.
 * Returns `{ sent: false, reason }` when:
 *   - Integration is not connected (reason: 'not connected')
 *   - Network error (reason: 'network: <message>')
 *   - Telegram API error (reason: HTTP status or API error description)
 */
export async function sendTelegram(
  text: string,
  opts: SendTelegramOptions = {},
): Promise<SendTelegramResult> {
  let config: TelegramConfig | null;
  try {
    config = await getTelegramConfig();
  } catch (err) {
    console.warn('[telegram] failed to read config:', (err as Error).message);
    return { sent: false, reason: 'config read error' };
  }

  if (!config) {
    return { sent: false, reason: 'not connected' };
  }

  const { bot_token, chat_id } = config;
  const url = `${TELEGRAM_API}/bot${bot_token}/sendMessage`;

  const body: Record<string, unknown> = {
    chat_id,
    text,
    parse_mode: opts.parse_mode ?? 'HTML',
    disable_web_page_preview: opts.disable_web_page_preview ?? true,
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    const msg = `network: ${(err as Error).message}`;
    console.warn('[telegram] send failed:', msg);
    return { sent: false, reason: msg };
  }

  if (res.ok) {
    return { sent: true };
  }

  // Parse the Telegram API error description when available.
  let reason = `HTTP ${res.status}`;
  try {
    const parsed = (await res.json()) as { description?: string };
    if (parsed.description) reason = parsed.description;
  } catch {
    // keep the HTTP status reason
  }

  console.warn('[telegram] API error:', reason);
  return { sent: false, reason };
}

// ── Private helpers ──────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/** Minimal HTML escaping for Telegram's HTML parse mode. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
