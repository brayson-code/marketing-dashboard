// AgentMail (agentmail.to) — per-tenant email-agent infrastructure (BYO key).
//
// Each tenant brings their OWN AgentMail account by pasting their API key in the
// Connections tab. It's stored AES-256-GCM encrypted in client_integrations,
// scoped to tenant_id (see integrations-store.ts). So a tenant's inboxes, sends,
// and reputation are fully isolated under THEIR account. Falls back to
// AGENTMAIL_API_KEY (env) for the owner/HQ tenant + local testing.
//
// REST API: https://api.agentmail.to (v0). Auth `Bearer am_...`. Responses are
// FLAT (not {data:...}). Inboxes are addressed username@domain; the opaque id is
// `inbox_id`. (Confirmed against docs.agentmail.to/llms-full.txt — NOT the
// `theagentmail.net` skill, which is a different product.)

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDecryptedSecret } from './integrations-store';

const BASE = 'https://api.agentmail.to';

/** The AgentMail API key for the CURRENT tenant: their pasted key first, then
 *  the env fallback (owner/HQ + local testing). Null when neither is set.
 *  Relies on the caller having entered tenant context (enterTenant). */
export async function getAgentMailKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('agentmail');
    const tenantKey = secret?.api_key?.trim();
    if (tenantKey) return tenantKey;
  } catch {
    /* fall through to env */
  }
  const envKey = process.env.AGENTMAIL_API_KEY?.trim();
  return envKey || null;
}

/** True when this tenant has a usable AgentMail key (their own or the env fallback). */
export async function isConnected(): Promise<boolean> {
  return (await getAgentMailKey()) !== null;
}

interface AmOpts { method?: 'GET' | 'POST' | 'DELETE'; body?: unknown }

async function amFetch<T = unknown>(path: string, opts: AmOpts = {}): Promise<T> {
  const key = await getAgentMailKey();
  if (!key) throw new Error('agentmail: no API key for this tenant');
  const res = await fetch(`${BASE}${path}`, {
    method: opts.method ?? 'GET',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`agentmail ${res.status}: ${txt.slice(0, 200)}`);
  }
  // AgentMail v0 returns flat objects (no {data} wrapper).
  return (await res.json().catch(() => ({}))) as T;
}

// ── Types (mirror the agentmail.to v0 API) ───────────────────────────────────

export interface AmInbox {
  // In agentmail.to the inbox_id IS the email address (e.g. "demo@agentmail.to").
  inbox_id: string;
  email?: string;
  display_name?: string | null;
}

/** The email address for an inbox (prefer the explicit `email`; inbox_id == email). */
export function inboxAddress(i: AmInbox): string {
  return i.email || i.inbox_id;
}

// inbox_id contains '@' and '.', so it MUST be percent-encoded in URL paths.
function enc(inboxId: string): string {
  return encodeURIComponent(inboxId);
}

export interface AmMessage {
  message_id: string;
  thread_id?: string;
  from?: string;
  to?: string[] | string;
  subject?: string;
  text?: string;       // full body — only in the GET-one (detail) view
  html?: string;
  preview?: string;    // short preview — present in the LIST view
  labels?: string[];   // direction lives here: ["sent"] = outbound, else inbound
  timestamp?: string | number;
  created_at?: string;
}

// ── Operations ───────────────────────────────────────────────────────────────

/** Every inbox under this tenant's AgentMail account. */
export async function listInboxes(): Promise<AmInbox[]> {
  const d = await amFetch<{ inboxes?: AmInbox[] }>('/inboxes');
  return Array.isArray(d.inboxes) ? d.inboxes : [];
}

/** Provision a new inbox. AgentMail assigns the address (username@domain) when
 *  not specified; we use whatever it returns. */
export async function createInbox(opts: { username?: string; displayName?: string } = {}): Promise<AmInbox> {
  const body: Record<string, unknown> = {};
  if (opts.username) body.username = opts.username;
  if (opts.displayName) body.display_name = opts.displayName;
  return amFetch<AmInbox>('/inboxes', { method: 'POST', body });
}

/** Send an email from one of the tenant's inboxes. */
export async function sendEmail(inboxId: string, msg: {
  to: string[]; subject: string; text: string; html?: string;
  cc?: string[]; bcc?: string[]; replyTo?: string;
}): Promise<{ message_id: string; thread_id?: string }> {
  return amFetch(`/inboxes/${enc(inboxId)}/messages/send`, {
    method: 'POST',
    body: {
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      cc: msg.cc,
      bcc: msg.bcc,
      reply_to: msg.replyTo,
    },
  });
}

/** Recent messages in an inbox (inbound + outbound). */
export async function listMessages(inboxId: string): Promise<AmMessage[]> {
  const d = await amFetch<{ messages?: AmMessage[] }>(`/inboxes/${enc(inboxId)}/messages`);
  return Array.isArray(d.messages) ? d.messages : [];
}

/** Full message with body. */
export async function getMessage(inboxId: string, messageId: string): Promise<AmMessage> {
  return amFetch(`/inboxes/${enc(inboxId)}/messages/${enc(messageId)}`);
}

/** Org-level webhooks currently registered on the account. */
export async function listWebhooks(): Promise<Array<{ webhook_id: string; url: string }>> {
  const d = await amFetch<{ webhooks?: Array<{ webhook_id: string; url: string }> }>('/webhooks');
  return Array.isArray(d.webhooks) ? d.webhooks : [];
}

/** Register an ORG-LEVEL inbound webhook (agentmail.to webhooks are per-account,
 *  not per-inbox). Best-effort — inbound also works via polling, so a failure or
 *  shape mismatch here never blocks the integration. */
export async function registerWebhook(url: string): Promise<{ webhook_id?: string; secret?: string }> {
  return amFetch('/webhooks', { method: 'POST', body: { url, event_types: ['message.received'] } });
}

/** Verify an inbound webhook delivery's HMAC-SHA256 signature + 5-min freshness.
 *  Constant-time compare; tolerates seconds- or millisecond-unit timestamps. */
export function verifyWebhook(body: string, signature: string, timestamp: string, secret: string): boolean {
  if (!signature || !timestamp) return false;
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const tsMs = tsNum < 1e12 ? tsNum * 1000 : tsNum;
  if (Math.abs(Date.now() - tsMs) > 5 * 60 * 1000) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  let a: Buffer;
  let b: Buffer;
  try {
    a = Buffer.from(expected, 'hex');
    b = Buffer.from(signature, 'hex');
  } catch {
    return false;
  }
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
