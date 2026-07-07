// Shared plumbing for the Jobber OAuth routes (connect/callback/status/disconnect).
// NOT a route — Next's app router only wires up route.ts/page.tsx, so this file is
// invisible to routing and safe to keep local to this directory (kept out of
// src/lib/jobber.ts, which is a separate build track owned by whoever wires the
// Jobber GraphQL client + write-tools; see [[orchestrator-tool-wiring]] for that
// track's shape). Everything OAuth-handshake-specific lives here instead so this
// directory is self-contained and doesn't race the parallel lib/jobber.ts build.
//
// Facts below are sourced from developer.getjobber.com (fetched directly — see the
// build's research notes). Anything NOT explicitly confirmed there is marked
// TODO-verify and implemented defensively (never invents a field it can't fall back
// from).

import { NextRequest, NextResponse } from 'next/server';

/** Jobber implements ONLY the authorization-code grant (confirmed in their docs). */
export const JOBBER_AUTHORIZE_URL = 'https://api.getjobber.com/api/oauth/authorize';
export const JOBBER_TOKEN_URL = 'https://api.getjobber.com/api/oauth/token';
export const JOBBER_GRAPHQL_URL = 'https://api.getjobber.com/api/graphql';

// TODO-verify: Jobber requires X-JOBBER-GRAPHQL-VERSION on every GraphQL call and
// auto-upgrades a stale/removed version rather than failing, so a slightly-behind
// value here degrades gracefully — but confirm this is still current against
// https://developer.getjobber.com/docs/changelog/ before relying on it long-term.
export const JOBBER_GRAPHQL_VERSION = '2025-04-16';

export const STATE_COOKIE = 'jobber_oauth_state';
export const STATE_COOKIE_MAX_AGE = 10 * 60; // 10 minutes

/** Same secure-cookie heuristic used by the (legacy) Google OAuth routes:
 *  explicit env override first, then the request's forwarded/actual protocol. */
export function shouldUseSecureCookies(request: NextRequest): boolean {
  const forced = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === 'true' || forced === '1' || forced === 'yes') return true;
  if (forced === 'false' || forced === '0' || forced === 'no') return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }
  try {
    return request.nextUrl.protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

/**
 * Stable base URL for building the OAuth redirect_uri. Jobber requires this to
 * match EXACTLY what's registered as the app's callback URL in the Developer
 * Center, so we prefer the explicit env vars (stable across deploys/previews)
 * over anything derived from the incoming request, and only fall back to the
 * request's own origin as a last resort for local/dev use without APP_URL set.
 */
export function appBaseUrl(request: NextRequest): string {
  const fromEnv =
    process.env.APP_URL?.trim().replace(/\/$/, '') ||
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '');
  if (fromEnv) return fromEnv;
  try {
    return request.nextUrl.origin;
  } catch {
    return '';
  }
}

/** The exact redirect_uri used for BOTH the authorize request and the token
 *  exchange — these must be byte-identical per the OAuth spec. */
export function jobberCallbackUrl(request: NextRequest): string {
  return `${appBaseUrl(request)}/api/integrations/jobber/callback`;
}

/** Platform app creds (operator-configured, not per-tenant). Returns null when
 *  either is unset so callers can 501 instead of half-starting the flow. */
export function jobberClientCredentials(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.JOBBER_CLIENT_ID?.trim();
  const clientSecret = process.env.JOBBER_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** True only when both platform env creds are present — mirrors the frontend's
 *  `configured` contract (see integrations-panel.tsx's OAuthProviderTile). */
export function jobberConfigured(): boolean {
  return jobberClientCredentials() != null;
}

/** Redirect back to the Connections page. Never carries token material or raw
 *  upstream error bodies — only a short, safe-to-display message. */
export function connectionsRedirect(
  request: NextRequest,
  params: { connected?: string; error?: string },
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = '/connections';
  url.search = '';
  if (params.connected) url.searchParams.set('connected', params.connected);
  if (params.error) url.searchParams.set('error', params.error);
  return NextResponse.redirect(url);
}

export interface JobberTokenResponse {
  access_token: string;
  refresh_token: string;
  /** Not shown in Jobber's own documented response example (which only shows
   *  access_token/refresh_token) — some OAuth servers include it anyway.
   *  TODO-verify: confirm whether Jobber's token endpoint actually returns this. */
  expires_in?: number;
}

/**
 * Decode (NOT verify — Jobber's docs explicitly say the signature can't be
 * verified client-side; only Jobber can) the `exp` claim out of the JWT access
 * token. Returns epoch seconds, or null if the token isn't a well-formed JWT.
 */
export function decodeJwtExpSeconds(jwt: string): number | null {
  try {
    const payloadPart = jwt.split('.')[1];
    if (!payloadPart) return null;
    const base64 = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = Buffer.from(padded, 'base64').toString('utf8');
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp : null;
  } catch {
    return null;
  }
}

/** Default access-token lifetime per Jobber's docs (both the OAuth guide and the
 *  Getting Started GraphiQL note say 60 minutes) — used only when we can't read
 *  `expires_in` from the response or `exp` from the JWT payload. */
const DEFAULT_TOKEN_LIFETIME_SECONDS = 60 * 60;

/** Resolve an expires_at (epoch seconds) for a fresh token response, preferring
 *  the response's own `expires_in` if present, then the JWT's `exp` claim, then
 *  the documented 60-minute default. */
export function resolveExpiresAt(token: JobberTokenResponse): number {
  const now = Math.floor(Date.now() / 1000);
  if (typeof token.expires_in === 'number' && token.expires_in > 0) {
    return now + token.expires_in;
  }
  const exp = decodeJwtExpSeconds(token.access_token);
  if (exp != null) return exp;
  return now + DEFAULT_TOKEN_LIFETIME_SECONDS;
}

/**
 * POST to the Jobber token endpoint (authorization_code or refresh_token grant —
 * same endpoint, different body per Jobber's docs). client_secret is only ever
 * used server-side, here.
 */
async function requestJobberToken(body: URLSearchParams): Promise<JobberTokenResponse> {
  const response = await fetch(JOBBER_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!response.ok) {
    // Never forward the raw upstream body (could echo back client_secret context
    // or other sensitive detail) — just the status for logs.
    throw new Error(`Jobber token endpoint returned ${response.status}`);
  }
  const payload = (await response.json()) as Partial<JobberTokenResponse>;
  if (!payload.access_token || !payload.refresh_token) {
    throw new Error('Jobber token response missing access_token/refresh_token');
  }
  return { access_token: payload.access_token, refresh_token: payload.refresh_token, expires_in: payload.expires_in };
}

export async function exchangeJobberCode(
  code: string,
  redirectUri: string,
): Promise<JobberTokenResponse> {
  const creds = jobberClientCredentials();
  if (!creds) throw new Error('Jobber is not configured');
  const body = new URLSearchParams({
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  return requestJobberToken(body);
}

// NOTE: no refresh helper here on purpose. Token refresh lives ONLY in
// lib/jobber.ts (single-flight per tenant) — a second refresh implementation
// would race it under Jobber's one-time-use refresh-token rotation.
