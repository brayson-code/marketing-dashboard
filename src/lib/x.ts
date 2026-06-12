// X (Twitter) integration via Nango. Publish-only for now: posts approved
// content_post drafts as tweets, threading anything over 280 characters.
// Reads (mentions, analytics) are NOT wired — X's API meters those separately
// and the paid tier we assume here is posting-only.
//
// Nango handles the OAuth token + refresh — we never see the access token.
// Failures bubble up with a tagged 'x: …' error so drafts.publishContent can
// surface "X publish failed" with the real cause instead of a fake success.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'x';

/** X's hard limit per tweet. We count UTF-16 units, which over-counts emoji vs
 *  X's weighted scheme — conservative is fine here (chunks come out shorter). */
const X_CHAR_LIMIT = 280;

interface XConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's X connection. Null if not connected. */
async function getConn(): Promise<XConn | null> {
  const rows = (await sql()`
    SELECT connection_id, provider_config_key
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER} AND status = 'connected'
    LIMIT 1
  `) as unknown as Array<{ connection_id: string; provider_config_key: string }>;
  const r = rows[0];
  if (!r?.connection_id) return null;
  return { connection_id: r.connection_id, provider_config_key: r.provider_config_key || providerConfigKeyFor(PROVIDER) };
}

interface ProxyOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  endpoint: string;             // e.g. '/2/tweets'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** Call an X API v2 endpoint through the Nango proxy. Throws a tagged Error on
 *  any failure so callers can show "X is unreachable" vs. their own error. */
async function xProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('x: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('x: not connected for this tenant');

  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== '') params[k] = v;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res: any = await nango.proxy({
    method: opts.method ?? 'GET',
    endpoint: opts.endpoint,
    providerConfigKey: conn.provider_config_key,
    connectionId: conn.connection_id,
    params: Object.keys(params).length ? params : undefined,
    data: opts.data,
  });
  return res?.data as T;
}

/**
 * Split long copy into tweet-sized chunks for a thread. Boundary preference:
 * paragraphs (blank lines) → sentences/line breaks → words → hard slice
 * (pathological unbroken tokens only). Paragraphs that fit together are packed
 * into one tweet to keep threads short.
 */
function splitForThread(text: string, limit = X_CHAR_LIMIT): string[] {
  const out: string[] = [];
  let cur = '';
  const flush = () => { if (cur.trim()) out.push(cur.trim()); cur = ''; };

  for (const para of text.trim().split(/\n{2,}/)) {
    const psep = cur ? '\n\n' : '';
    if ((cur + psep + para).length <= limit) { cur = cur + psep + para; continue; }
    flush();
    if (para.length <= limit) { cur = para; continue; }

    // Paragraph alone is too long — pack sentences. Mark sentence ends with a
    // newline then split on newlines (which also treats the paragraph's own
    // single line breaks as boundaries). No regex lookbehind: tsconfig targets
    // ES2017, which predates it.
    const sentences = para.replace(/([.!?…])\s+/g, '$1\n').split(/\s*\n\s*/);
    for (const sentence of sentences) {
      const ssep = cur ? ' ' : '';
      if ((cur + ssep + sentence).length <= limit) { cur = cur + ssep + sentence; continue; }
      flush();
      if (sentence.length <= limit) { cur = sentence; continue; }

      // Run-on sentence — wrap on word boundaries.
      for (const word of sentence.split(/\s+/)) {
        const wsep = cur ? ' ' : '';
        if ((cur + wsep + word).length <= limit) { cur = cur + wsep + word; continue; }
        flush();
        if (word.length <= limit) { cur = word; continue; }
        // A single unbroken token longer than a tweet (URL-from-hell) — hard slice.
        for (let i = 0; i < word.length; i += limit) {
          cur = word.slice(i, i + limit);
          if (cur.length === limit) flush();
        }
      }
    }
  }
  flush();
  return out;
}

/**
 * Post text to X as the connected account. Copy over 280 characters becomes a
 * thread (each chunk replies to the previous tweet). Returns the FIRST tweet's
 * id — that's the thread's permalink anchor.
 */
export async function postTweet(text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('x: empty tweet text');

  const parts = splitForThread(body);
  interface Resp { data?: { id?: string } }

  let firstId: string | null = null;
  let prevId: string | null = null;
  for (const part of parts) {
    const payload: Record<string, unknown> = { text: part };
    if (prevId) payload.reply = { in_reply_to_tweet_id: prevId };

    let r: Resp;
    try {
      r = await xProxy<Resp>({ method: 'POST', endpoint: '/2/tweets', data: payload });
    } catch (e) {
      // Mid-thread failure leaves a partial thread up — say so, with the anchor
      // id, so the operator can finish or delete it by hand instead of double-posting.
      if (firstId) throw new Error(`x: thread continuation failed after tweet ${firstId} was posted: ${(e as Error).message}`);
      throw e;
    }
    const tid = r?.data?.id;
    if (!tid) {
      if (firstId) throw new Error(`x: thread reply returned no id (first tweet ${firstId} did post)`);
      throw new Error('x: tweet API returned no id');
    }
    firstId ??= tid;
    prevId = tid;
  }

  if (!firstId) throw new Error('x: nothing to post');
  return firstId;
}

/** True if this tenant has a connected X account — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}
