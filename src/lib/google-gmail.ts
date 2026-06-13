// Gmail integration via Nango — rides the SAME 'google-workspace' connection as
// Drive/Docs/Sheets (one "Connect Google" grant carries the gmail.modify scope).
// We do NOT duplicate any connection logic: getConn() + gwProxy() are imported
// from google-workspace.ts so all of Google shares one connection + proxy path.
//
// Nango handles the OAuth token + refresh — we never see the access token, and
// nothing here logs tokens. Failures bubble up as tagged Errors ('google-gmail:
// <cause>'). Fail closed: when the tenant isn't connected, gwProxy throws a
// tagged error instead of acting.
//
// Gmail lives at https://gmail.googleapis.com/gmail/v1 — every call passes that
// FULL endpoint URL to the Nango proxy (the proxy routes by host).

import { gwProxy, isWorkspaceConnected } from './google-workspace';

const TAG = 'google-gmail';
const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1';
// Gmail addresses the authenticated user as 'me' on every users.* endpoint.
const ME = 'me';

/** True if this tenant has a connected Google account — cheap check, no API call.
 *  Gmail rides the same connection as Drive/Docs/Sheets, so this is the workspace
 *  connection check re-exported under a Gmail-flavoured name. */
export async function isGmailConnected(): Promise<boolean> {
  return isWorkspaceConnected();
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  snippet: string;
  /** RFC2822 Date header value as Gmail returns it (string; may be empty). */
  date: string;
}

/** Pull a single header value (case-insensitive) from a message's header list. */
function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const want = name.toLowerCase();
  const h = (headers ?? []).find((x) => (x.name ?? '').toLowerCase() === want);
  return h?.value ?? '';
}

interface GmailMessageResp {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: { headers?: Array<{ name?: string; value?: string }> };
}

/** Map a metadata-format users.messages.get response to a lightweight summary. */
function toSummary(m: GmailMessageResp): GmailMessageSummary {
  const headers = m.payload?.headers;
  return {
    id: m.id ?? '',
    threadId: m.threadId ?? '',
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    subject: header(headers, 'Subject'),
    snippet: m.snippet ?? '',
    date: header(headers, 'Date'),
  };
}

/**
 * The most recent messages in the tenant's mailbox, newest first. Lists ids via
 * users.messages.list then fetches each in 'metadata' format (from/to/subject +
 * snippet/date only — no body download), so this stays light.
 */
export async function listRecentMessages(limit = 10): Promise<GmailMessageSummary[]> {
  const max = Math.max(1, Math.min(limit, 50));
  interface ListResp { messages?: Array<{ id?: string }> }
  const list = await gwProxy<ListResp>(
    {
      endpoint: `${GMAIL_BASE}/users/${ME}/messages`,
      params: { maxResults: max },
    },
    TAG,
  );
  const ids = (list.messages ?? []).map((m) => m.id).filter((id): id is string => !!id);
  if (ids.length === 0) return [];

  // Fetch each message's metadata. Done in parallel — Gmail rate limits are
  // per-user-per-second and `max` is capped at 50, so a small fan-out is fine.
  const summaries = await Promise.all(
    ids.map((id) =>
      gwProxy<GmailMessageResp>(
        {
          endpoint: `${GMAIL_BASE}/users/${ME}/messages/${id}`,
          params: { format: 'metadata', metadataHeaders: 'From,To,Subject,Date' },
        },
        TAG,
      ).then(toSummary),
    ),
  );
  return summaries;
}

export interface GmailMessage extends GmailMessageSummary {
  /** Plain-text body, best-effort extracted from the MIME tree (may be empty). */
  body: string;
}

/** Walk a Gmail MIME payload tree and return the first text/plain body found,
 *  decoded from base64url. Falls back to the top-level body when there are no
 *  parts (a non-multipart message). */
function extractPlainText(payload: GmailFullPayload | undefined): string {
  if (!payload) return '';
  const decode = (data?: string): string => {
    if (!data) return '';
    try {
      return Buffer.from(data, 'base64url').toString('utf8');
    } catch {
      return '';
    }
  };
  // Non-multipart: the body sits directly on the payload.
  if (!payload.parts || payload.parts.length === 0) {
    return decode(payload.body?.data);
  }
  // Depth-first search for the first text/plain part.
  const stack: GmailFullPayload[] = [...payload.parts];
  while (stack.length) {
    const part = stack.shift()!;
    if ((part.mimeType ?? '') === 'text/plain' && part.body?.data) {
      return decode(part.body.data);
    }
    if (part.parts) stack.push(...part.parts);
  }
  // Fallback: first text/* of any kind, then the raw top-level body.
  return decode(payload.body?.data);
}

interface GmailFullPayload {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string };
  parts?: GmailFullPayload[];
}

interface GmailFullResp {
  id?: string;
  threadId?: string;
  snippet?: string;
  payload?: GmailFullPayload;
}

/** Fetch a single message in full and return its headers + plain-text body. */
export async function getMessage(id: string): Promise<GmailMessage> {
  const messageId = String(id ?? '').trim();
  if (!messageId) throw new Error(`${TAG}: message id is required`);
  const m = await gwProxy<GmailFullResp>(
    {
      endpoint: `${GMAIL_BASE}/users/${ME}/messages/${messageId}`,
      params: { format: 'full' },
    },
    TAG,
  );
  const headers = m.payload?.headers;
  return {
    id: m.id ?? messageId,
    threadId: m.threadId ?? '',
    from: header(headers, 'From'),
    to: header(headers, 'To'),
    subject: header(headers, 'Subject'),
    snippet: m.snippet ?? '',
    date: header(headers, 'Date'),
    body: extractPlainText(m.payload),
  };
}

// ── Writes ──────────────────────────────────────────────────────────────────

export interface SendMessageInput {
  to: string;
  subject: string;
  text: string;
}

/** Encode a header value containing non-ASCII as RFC 2047 (UTF-8, base64) so
 *  subjects with emoji/accents survive. Pure-ASCII values pass through unchanged. */
function encodeHeader(value: string): string {
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

/** Build an RFC 822 message and return it as a base64url string (Gmail's `raw`
 *  field format). The body is sent as UTF-8 text/plain. */
function buildRawMessage(input: SendMessageInput): string {
  const to = String(input.to ?? '').trim();
  const subject = String(input.subject ?? '');
  const text = String(input.text ?? '');
  const lines = [
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
  ];
  // CRLF line endings per RFC 822, then base64url for Gmail's `raw` field.
  return Buffer.from(lines.join('\r\n'), 'utf8').toString('base64url');
}

export interface GmailSendResult {
  id: string;
  threadId: string;
}

/** Send an email from the connected account via users.messages.send. */
export async function sendMessage(input: SendMessageInput): Promise<GmailSendResult> {
  if (!String(input?.to ?? '').trim()) throw new Error(`${TAG}: "to" is required`);
  if (!String(input?.subject ?? '').trim()) throw new Error(`${TAG}: "subject" is required`);
  const raw = buildRawMessage(input);
  interface SendResp { id?: string; threadId?: string }
  const r = await gwProxy<SendResp>(
    {
      method: 'POST',
      endpoint: `${GMAIL_BASE}/users/${ME}/messages/send`,
      data: { raw },
    },
    TAG,
  );
  if (!r?.id) throw new Error(`${TAG}: send returned no message id`);
  return { id: r.id, threadId: r.threadId ?? '' };
}

export interface GmailDraftResult {
  draftId: string;
  messageId: string;
}

/** Create a draft email (not sent) in the connected account via users.drafts.create. */
export async function createDraft(input: SendMessageInput): Promise<GmailDraftResult> {
  if (!String(input?.to ?? '').trim()) throw new Error(`${TAG}: "to" is required`);
  if (!String(input?.subject ?? '').trim()) throw new Error(`${TAG}: "subject" is required`);
  const raw = buildRawMessage(input);
  interface DraftResp { id?: string; message?: { id?: string } }
  const r = await gwProxy<DraftResp>(
    {
      method: 'POST',
      endpoint: `${GMAIL_BASE}/users/${ME}/drafts`,
      data: { message: { raw } },
    },
    TAG,
  );
  if (!r?.id) throw new Error(`${TAG}: draft create returned no id`);
  return { draftId: r.id, messageId: r.message?.id ?? '' };
}
