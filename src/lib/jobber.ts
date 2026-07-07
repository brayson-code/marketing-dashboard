// Jobber — per-tenant access to the Jobber Developer Platform (OAuth 2.0 + GraphQL).
//
// BYO connection: each tenant connects Jobber on the Connections page (OAuth
// authorization-code flow, owned by the OAuth routes). The resulting tokens are
// stored AES-256 encrypted, scoped to tenant_id, under provider id 'jobber' in the
// existing secret store (integrations-store.ts). The secret blob is a flat
// Record<string,string>: { access_token, refresh_token }. Token expiry lives in the
// first-class client_integrations.expires_at column (epoch seconds) — the SAME
// source of truth the OAuth callback + /status route write/read; we do NOT duplicate
// it inside the secret blob.
//
// This module NEVER logs a token or the client secret and NEVER sends them to the
// browser. Access tokens are short-lived JWTs (default 60 min) — we refresh them
// transparently (single-flight per tenant) using the platform app credentials from
// env (JOBBER_CLIENT_ID / JOBBER_CLIENT_SECRET) and persist any rotated tokens back.
//
// Facts that the integration research left THIN or truncated (esp. the exact GraphQL
// field/enum/mutation-argument names) are implemented from best-known Jobber schema
// knowledge and marked `TODO-verify` against the live schema / GraphiQL. Two failure
// modes, only one of which is graceful: a null VALUE in a valid response maps to
// null/empty without throwing; a wrong field NAME makes Jobber reject the whole
// query, so jobberGraphQL throws a clean "Jobber API error" and that ENTIRE tool
// stays dead until the field is corrected (the tool handler converts it to an
// is_error result, so the agent turn survives). After the first real Jobber account
// is connected, run each tool once and fix any TODO-verify names it flags.

import { tenantId } from './db/client';
import { getDecryptedSecret, getIntegration, upsertIntegration } from './integrations-store';

// ── Platform constants (from the OAuth/GraphQL research; verify on drift) ──────
const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';
// X-JOBBER-GRAPHQL-VERSION — the latest confirmed-real dated version from Jobber's
// own changelog at research time. Required on every request. TODO-verify: bump when
// Jobber ships a newer dated version; requesting a since-removed version
// auto-upgrades to the oldest still-supported one.
const JOBBER_GRAPHQL_VERSION = '2025-04-16';
// Access tokens are JWTs carrying `exp`; default lifetime is 60 min. We derive
// expiry from the JWT and only fall back to this fixed TTL when it can't be decoded.
const ACCESS_TOKEN_TTL_FALLBACK_SEC = 60 * 60;
// Refresh proactively when the access token is within this many seconds of expiry.
const REFRESH_SKEW_SEC = 60;
// Hard clamp on `first:` page sizes so an agent can't ask for an unbounded page.
const MAX_PAGE = 100;

/** Thrown by jobberGraphQL (and the typed helpers) when the current tenant has no
 *  Jobber tokens. Callers surface a friendly "connect Jobber" message rather than
 *  treating this as a hard failure. */
export class JobberNotConnectedError extends Error {
  constructor(message = 'Jobber is not connected for this workspace.') {
    super(message);
    this.name = 'JobberNotConnectedError';
  }
}

export interface JobberTokens {
  access_token: string;
  refresh_token: string;
  /** epoch seconds */
  expires_at: number;
}

// ── Token read / refresh ──────────────────────────────────────────────────────

/** The current tenant's Jobber tokens, or null when not connected. Relies on the
 *  caller having entered tenant context (enterTenant). Never throws. */
export async function getJobberTokens(): Promise<JobberTokens | null> {
  let secret: Record<string, string> | null;
  try {
    secret = await getDecryptedSecret('jobber');
  } catch {
    return null;
  }
  if (!secret) return null;
  const access_token = (secret.access_token ?? '').trim();
  const refresh_token = (secret.refresh_token ?? '').trim();
  if (!access_token || !refresh_token) return null;
  // Expiry is the first-class row column (written by the OAuth callback and by our
  // own refresh via upsertIntegration's `expires_at` param) — the single source of
  // truth the /status route also reads. Fall back to a legacy in-secret value (older
  // rows), then 0, which just forces one proactive refresh.
  const row = await getIntegration('jobber').catch(() => undefined);
  let expires_at = 0;
  if (typeof row?.expires_at === 'number' && Number.isFinite(row.expires_at)) {
    expires_at = row.expires_at;
  } else {
    const parsed = Number.parseInt(secret.expires_at ?? '', 10);
    if (Number.isFinite(parsed)) expires_at = parsed;
  }
  return { access_token, refresh_token, expires_at };
}

/** Decode the `exp` (epoch seconds) claim from a JWT access token without verifying
 *  the signature (only Jobber can verify it — we just need the expiry). Null on any
 *  parse failure so the caller falls back to a fixed TTL. */
function decodeJwtExp(accessToken: string): number | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length < 2) return null;
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = Buffer.from(b64, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: unknown };
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Persist rotated tokens back to the encrypted per-tenant secret store. Writes the
 *  two token fields into the secret blob and the expiry into the first-class
 *  `expires_at` row column (matching the OAuth callback + /status route), so both the
 *  agent path and the status route read one consistent expiry. label/config are
 *  preserved by upsertIntegration's COALESCE. Never logs the token values. */
async function persistTokens(t: JobberTokens): Promise<void> {
  await upsertIntegration({
    provider: 'jobber',
    secret: {
      access_token: t.access_token,
      refresh_token: t.refresh_token,
    },
    expires_at: t.expires_at,
  });
}

// Single-flight refresh guard, keyed per tenant. Two concurrent callers that both
// need a refresh share ONE in-flight HTTP refresh — important when refresh-token
// rotation is ON (a refresh token must never be sent twice). The tenant key is
// captured synchronously before any await so it can't drift.
const refreshInFlight = new Map<string, Promise<JobberTokens>>();

async function refreshTokens(refreshToken: string): Promise<JobberTokens> {
  const key = tenantId();
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  const p = performRefresh(refreshToken);
  refreshInFlight.set(key, p);
  try {
    return await p;
  } finally {
    refreshInFlight.delete(key);
  }
}

async function performRefresh(refreshToken: string): Promise<JobberTokens> {
  const clientId = process.env.JOBBER_CLIENT_ID;
  const clientSecret = process.env.JOBBER_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'Jobber app credentials are not configured — set JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET.',
    );
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  const res = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    // Jobber's error body never contains our client_secret; still, keep it short.
    const detail = await safeText(res);
    throw new Error(`Jobber token refresh failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }
  const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; refresh_token?: unknown };
  const access_token = typeof json.access_token === 'string' ? json.access_token : '';
  if (!access_token) throw new Error('Jobber token refresh returned no access_token.');
  // Rotation ON → a new refresh token comes back; rotation OFF → the same one. Keep
  // the returned one when present, else reuse the one we sent.
  const refresh_token =
    typeof json.refresh_token === 'string' && json.refresh_token.trim() ? json.refresh_token : refreshToken;
  const expires_at = decodeJwtExp(access_token) ?? Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_FALLBACK_SEC;
  const tokens: JobberTokens = { access_token, refresh_token, expires_at };
  await persistTokens(tokens);
  return tokens;
}

/** Return valid tokens, refreshing first when the access token is within
 *  REFRESH_SKEW_SEC of expiry. Null when the tenant isn't connected. */
export async function refreshIfNeeded(): Promise<JobberTokens | null> {
  const tokens = await getJobberTokens();
  if (!tokens) return null;
  const now = Math.floor(Date.now() / 1000);
  if (tokens.expires_at - now > REFRESH_SKEW_SEC) return tokens;
  return refreshTokens(tokens.refresh_token);
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

// ── GraphQL ───────────────────────────────────────────────────────────────────

async function rawGraphQL(accessToken: string, query: string, variables: Record<string, unknown>): Promise<Response> {
  return fetch(JOBBER_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      // Mandatory as of 2024-04-02 — urlencoded/multipart bodies are rejected.
      'Content-Type': 'application/json',
      'X-JOBBER-GRAPHQL-VERSION': JOBBER_GRAPHQL_VERSION,
    },
    body: JSON.stringify({ query, variables }),
  });
}

/**
 * POST a GraphQL query/mutation to Jobber with the current tenant's token.
 * - Throws JobberNotConnectedError when the tenant has no tokens.
 * - Refreshes proactively (expiry) and reactively (a single 401 retry after a
 *   forced refresh using the freshest persisted refresh token).
 * - Surfaces Jobber `errors[].message` as a clean Error; returns `data` on success.
 */
export async function jobberGraphQL<T = unknown>(
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  let tokens = await refreshIfNeeded();
  if (!tokens) throw new JobberNotConnectedError();

  let res = await rawGraphQL(tokens.access_token, query, variables);

  // An expired/invalid token surfaces as 401 "Invalid Token Error" — force one
  // refresh off the freshest persisted refresh token and retry exactly once.
  if (res.status === 401) {
    const current = await getJobberTokens();
    if (!current) throw new JobberNotConnectedError();
    tokens = await refreshTokens(current.refresh_token);
    res = await rawGraphQL(tokens.access_token, query, variables);
  }

  if (!res.ok) {
    const detail = await safeText(res);
    throw new Error(`Jobber API request failed (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }

  const bodyJson = (await res.json().catch(() => null)) as
    | { data?: T; errors?: Array<{ message?: string }> }
    | null;
  if (!bodyJson) throw new Error('Jobber API returned an unreadable response.');
  if (bodyJson.errors && bodyJson.errors.length > 0) {
    const msg = bodyJson.errors.map((e) => e?.message ?? 'unknown error').join('; ');
    throw new Error(`Jobber API error: ${msg}`);
  }
  if (bodyJson.data === undefined || bodyJson.data === null) {
    throw new Error('Jobber API returned no data.');
  }
  return bodyJson.data;
}

// ── Defensive readers ──────────────────────────────────────────────────────────

function rec(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}
function asStr(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}
function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}
function asBool(v: unknown): boolean {
  return v === true;
}
/** Read the `total` off an `amounts { total }` object (Quote/Invoice), tolerating a
 *  flat `total` field too. */
function readTotal(node: Record<string, unknown>): number | null {
  const amounts = rec(node.amounts);
  return asNum(amounts.total) ?? asNum(node.total);
}
/** Read a Jobber contact list (emails/phones) into a flat string[], tolerating both
 *  a plain array and a Relay `{ nodes: [...] }` connection shape. */
function readContactList(v: unknown, field: string): string[] {
  const arr: unknown[] = Array.isArray(v)
    ? v
    : Array.isArray(rec(v).nodes)
      ? (rec(v).nodes as unknown[])
      : [];
  const out: string[] = [];
  for (const item of arr) {
    const s = asStr(rec(item)[field]);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}
function clientName(node: Record<string, unknown>): string | null {
  return asStr(rec(node.client).name);
}
function clampLimit(n: number | undefined): number {
  const v = Math.floor(Number(n));
  if (!Number.isFinite(v) || v <= 0) return 10;
  return Math.min(v, MAX_PAGE);
}

// ── Flat result shapes (kept small for agent consumption) ──────────────────────

export interface JobberClientSummary {
  id: string;
  name: string;
  companyName: string | null;
  isCompany: boolean;
  emails: string[];
  phones: string[];
}
export interface JobberQuoteSummary {
  id: string;
  number: string | null;
  status: string | null;
  clientName: string | null;
  total: number | null;
  createdAt: string | null;
  updatedAt: string | null;
}
export interface JobberJobSummary {
  id: string;
  number: string | null;
  title: string | null;
  status: string | null;
  clientName: string | null;
  total: number | null;
  startAt: string | null;
  endAt: string | null;
}
export interface JobberInvoiceSummary {
  id: string;
  number: string | null;
  subject: string | null;
  status: string | null;
  clientName: string | null;
  total: number | null;
  dueDate: string | null;
  createdAt: string | null;
}

function mapClient(v: unknown): JobberClientSummary {
  const n = rec(v);
  const first = asStr(n.firstName) ?? '';
  const last = asStr(n.lastName) ?? '';
  const full = `${first} ${last}`.trim();
  const name = asStr(n.name) ?? (full || asStr(n.companyName) || 'Unnamed client');
  return {
    id: asStr(n.id) ?? '',
    name,
    companyName: asStr(n.companyName),
    isCompany: asBool(n.isCompany),
    emails: readContactList(n.emails, 'address'),
    phones: readContactList(n.phones, 'number'),
  };
}
function mapQuote(v: unknown): JobberQuoteSummary {
  const n = rec(v);
  return {
    id: asStr(n.id) ?? '',
    number: asStr(n.quoteNumber),
    status: asStr(n.quoteStatus),
    clientName: clientName(n),
    total: readTotal(n),
    createdAt: asStr(n.createdAt),
    updatedAt: asStr(n.updatedAt),
  };
}
function mapJob(v: unknown): JobberJobSummary {
  const n = rec(v);
  return {
    id: asStr(n.id) ?? '',
    number: asStr(n.jobNumber),
    title: asStr(n.title),
    status: asStr(n.jobStatus),
    clientName: clientName(n),
    total: readTotal(n),
    startAt: asStr(n.startAt),
    endAt: asStr(n.endAt),
  };
}
function mapInvoice(v: unknown): JobberInvoiceSummary {
  const n = rec(v);
  return {
    id: asStr(n.id) ?? '',
    number: asStr(n.invoiceNumber),
    subject: asStr(n.subject),
    status: asStr(n.invoiceStatus),
    clientName: clientName(n),
    total: readTotal(n),
    dueDate: asStr(n.dueDate),
    createdAt: asStr(n.createdAt),
  };
}

// ── GraphQL documents ──────────────────────────────────────────────────────────
// TODO-verify: the field/enum/argument names below are from best-known Jobber schema
// knowledge, NOT confirmed by the (truncated) research. Validate against the live
// schema / GraphiQL; a wrong field surfaces as a clean "Jobber API error" (caught in
// jobberGraphQL) rather than a crash.

const CLIENTS_QUERY = /* GraphQL */ `
  query KpClients($first: Int!, $searchTerm: String) {
    clients(first: $first, searchTerm: $searchTerm) {
      nodes { id name firstName lastName companyName isCompany }
    }
  }
`;
const CLIENT_QUERY = /* GraphQL */ `
  query KpClient($id: EncodedId!) {
    client(id: $id) {
      id name firstName lastName companyName isCompany
      emails { address primary }
      phones { number primary }
    }
  }
`;
const QUOTES_QUERY = /* GraphQL */ `
  query KpQuotes($first: Int!) {
    quotes(first: $first) {
      nodes {
        id quoteNumber quoteStatus
        client { id name }
        amounts { total }
        createdAt updatedAt
      }
    }
  }
`;
const JOBS_QUERY = /* GraphQL */ `
  query KpJobs($first: Int!) {
    jobs(first: $first) {
      nodes {
        id jobNumber title jobStatus
        client { id name }
        total startAt endAt
      }
    }
  }
`;
const INVOICES_QUERY = /* GraphQL */ `
  query KpInvoices($first: Int!) {
    invoices(first: $first) {
      nodes {
        id invoiceNumber subject invoiceStatus
        client { id name }
        amounts { total }
        dueDate createdAt
      }
    }
  }
`;
// Write path — best-effort mutation shape. The `*CreateAttributes` argument naming
// mirrors `JobCreateAttributes` referenced in Jobber's changelog. TODO-verify the
// mutation name, the `attributes`/`clientId`/`lineItems`/`unitPrice` field names,
// and the `userErrors` shape against the live schema before enabling in production.
const CREATE_QUOTE_MUTATION = /* GraphQL */ `
  mutation KpQuoteCreate($attributes: QuoteCreateAttributes!) {
    quoteCreate(attributes: $attributes) {
      quote { id quoteNumber quoteStatus }
      userErrors { message }
    }
  }
`;

// ── Typed helpers ───────────────────────────────────────────────────────────────

export async function listClients(search?: string, limit = 10): Promise<JobberClientSummary[]> {
  const first = clampLimit(limit);
  const data = await jobberGraphQL<{ clients?: { nodes?: unknown[] } }>(CLIENTS_QUERY, {
    first,
    searchTerm: search?.trim() || null,
  });
  return (data.clients?.nodes ?? []).map(mapClient);
}

export async function getClient(id: string): Promise<JobberClientSummary | null> {
  const clientId = (id ?? '').trim();
  if (!clientId) return null;
  const data = await jobberGraphQL<{ client?: unknown }>(CLIENT_QUERY, { id: clientId });
  return data.client ? mapClient(data.client) : null;
}

export async function listQuotes(opts: { status?: string; limit?: number } = {}): Promise<JobberQuoteSummary[]> {
  const limit = clampLimit(opts.limit ?? 10);
  // Status filtering is done CLIENT-SIDE (on the mapped `status`) to avoid guessing
  // the server-side filter input type — so over-fetch when a status is requested.
  // TODO-verify: replace with a native quotes(filter:) once the input type is known.
  const first = opts.status ? clampLimit(Math.max(limit, 50)) : limit;
  const data = await jobberGraphQL<{ quotes?: { nodes?: unknown[] } }>(QUOTES_QUERY, { first });
  let quotes = (data.quotes?.nodes ?? []).map(mapQuote);
  if (opts.status) {
    const s = opts.status.trim().toLowerCase();
    quotes = quotes.filter((q) => (q.status ?? '').toLowerCase() === s);
  }
  return quotes.slice(0, limit);
}

export async function listJobs(opts: { limit?: number } = {}): Promise<JobberJobSummary[]> {
  const first = clampLimit(opts.limit ?? 10);
  const data = await jobberGraphQL<{ jobs?: { nodes?: unknown[] } }>(JOBS_QUERY, { first });
  return (data.jobs?.nodes ?? []).map(mapJob);
}

export async function listInvoices(opts: { status?: string; limit?: number } = {}): Promise<JobberInvoiceSummary[]> {
  const limit = clampLimit(opts.limit ?? 10);
  const first = opts.status ? clampLimit(Math.max(limit, 50)) : limit;
  const data = await jobberGraphQL<{ invoices?: { nodes?: unknown[] } }>(INVOICES_QUERY, { first });
  let invoices = (data.invoices?.nodes ?? []).map(mapInvoice);
  if (opts.status) {
    const s = opts.status.trim().toLowerCase();
    invoices = invoices.filter((i) => (i.status ?? '').toLowerCase() === s);
  }
  return invoices.slice(0, limit);
}

export interface QuoteLineItemInput {
  name: string;
  description?: string;
  quantity: number;
  unitPrice: number;
}

/** Create a DRAFT quote in Jobber. The quote still requires human review/approval
 *  inside Jobber before it is sent — this only drafts it. */
export async function createQuoteDraft(input: {
  clientId: string;
  lineItems: QuoteLineItemInput[];
}): Promise<{ id: string; number: string | null; status: string | null }> {
  const clientId = (input.clientId ?? '').trim();
  if (!clientId) throw new Error('createQuoteDraft: clientId is required.');
  const lineItems = (input.lineItems ?? []).map((li) => ({
    name: li.name,
    description: li.description ?? null,
    quantity: li.quantity,
    unitPrice: li.unitPrice,
  }));
  if (lineItems.length === 0) throw new Error('createQuoteDraft: at least one line item is required.');

  const data = await jobberGraphQL<{
    quoteCreate?: { quote?: unknown; userErrors?: Array<{ message?: string }> };
  }>(CREATE_QUOTE_MUTATION, { attributes: { clientId, lineItems } });

  const userErrors = data.quoteCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`Jobber could not create the quote: ${userErrors.map((e) => e?.message ?? 'unknown error').join('; ')}`);
  }
  const q = rec(data.quoteCreate?.quote);
  const id = asStr(q.id);
  if (!id) throw new Error('Jobber quote creation returned no quote id.');
  return { id, number: asStr(q.quoteNumber), status: asStr(q.quoteStatus) };
}

/** True when the current tenant has Jobber tokens (used for prompt-awareness gating).
 *  Never throws. */
export async function jobberConnected(): Promise<boolean> {
  try {
    return (await getJobberTokens()) !== null;
  } catch {
    return false;
  }
}
