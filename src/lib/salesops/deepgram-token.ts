// SalesOps Deepgram token minting — the ONLY secret-derived value that ever leaves the
// server for the extension.
//
// The extension must NEVER hold the raw Deepgram API key. Instead, our backend reads the
// tenant's stored key (BYO via Connections, env fallback for HQ/dev — see getDeepgramKey)
// and exchanges it for a SHORT-LIVED Deepgram access token (JWT) via Deepgram's grant-token
// endpoint. The extension opens the realtime WebSocket with that JWT; the WebSocket only
// needs the token valid at connect time, so a short TTL is ideal.
//
// HARD RULE: the raw key is used only inside this function and is NEVER returned or logged.
// Only { access_token, expires_in } crosses the wire.
//
// Deepgram: POST https://api.deepgram.com/v1/auth/grant
//   header  Authorization: Token <key>
//   body    { ttl_seconds }   (default 30, max 3600)
//   → { access_token, expires_in }   (JWT)
// Docs: https://developers.deepgram.com/reference/token-based-auth-api/grant-token

import { getDeepgramKey } from '@/lib/deepgram';

const GRANT_URL = 'https://api.deepgram.com/v1/auth/grant';

/** Thrown when the current tenant has no Deepgram key configured. Routes map this to a
 *  clean 400 { error: 'connect_deepgram' } so the extension can prompt the rep. */
export class NoDeepgramKeyError extends Error {
  code = 'NO_DEEPGRAM_KEY' as const;
  constructor() {
    super('No Deepgram key configured for this tenant');
    this.name = 'NoDeepgramKeyError';
  }
}

export interface DeepgramGrant {
  access_token: string;
  expires_in: number;
}

interface DgGrantResponse {
  access_token?: string;
  expires_in?: number;
}

/**
 * Mint a short-lived Deepgram access token for the CURRENT tenant. Relies on the caller
 * having entered tenant context (enterTenant) so getDeepgramKey() resolves the right key.
 *
 * @param ttlSeconds token lifetime (default 60; clamped to Deepgram's 1..3600 range).
 * @throws NoDeepgramKeyError when the tenant has no key.
 * @throws Error on a non-2xx grant response (message is sanitized — never includes the key).
 */
export async function mintDeepgramGrant(ttlSeconds = 60): Promise<DeepgramGrant> {
  const key = await getDeepgramKey();
  if (!key) throw new NoDeepgramKeyError();

  const ttl = Math.max(1, Math.min(3600, Math.floor(ttlSeconds)));

  const res = await fetch(GRANT_URL, {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: ttl }),
  });

  if (!res.ok) {
    // Read the body for a status code only — NEVER echo the key. Deepgram's error body
    // does not contain the key, but we still cap the length defensively.
    const txt = await res.text().catch(() => '');
    throw new Error(`deepgram grant ${res.status}: ${txt.slice(0, 200)}`);
  }

  const data = (await res.json().catch(() => ({}))) as DgGrantResponse;
  if (!data.access_token) {
    throw new Error('deepgram grant: response missing access_token');
  }
  return {
    access_token: data.access_token,
    expires_in: typeof data.expires_in === 'number' ? data.expires_in : ttl,
  };
}
