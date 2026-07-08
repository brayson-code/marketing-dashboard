// Facebook Pages integration via Nango. Publish-only for now: posts approved
// content_post drafts to the FIRST Page the connected user manages. Multi-Page
// accounts get a picker later; one managed Page is the overwhelmingly common
// case for our tenants.
//
// Token subtlety: Nango holds the USER token and applies it to proxied calls.
// Posting to a Page's feed requires that Page's own access token, which the
// Graph API hands back per-Page on /me/accounts — we fetch it there and pass
// it explicitly as the access_token param on the publish call (an explicit
// access_token param takes precedence over the proxied user credential).
//
// Failures bubble up with a tagged 'facebook: …' error so drafts.publishContent
// can surface "Facebook publish failed" with the real cause.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'facebook';

// Same Graph API version the Instagram connector pins (instagram.ts).
const GRAPH_VERSION = 'v23.0';

interface FBConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's Facebook connection. Null if not connected. */
async function getConn(): Promise<FBConn | null> {
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
  endpoint: string;             // e.g. '/v23.0/me/accounts'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** Call a Graph API endpoint through the Nango proxy. Throws a tagged Error on
 *  any failure so callers can show "Facebook is unreachable" vs. their own error. */
async function fbProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('facebook: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('facebook: not connected for this tenant');

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

export interface FBPage {
  id: string;
  name: string;
  /** Page-scoped access token — required for posting to the Page's feed. */
  access_token: string;
}

/** The first Page the connected user manages (with its Page token). Throws a
 *  tagged error when the account manages no Pages — personal profiles can't
 *  be posted to via the API at all, so there's nothing to degrade to. */
async function getFirstManagedPage(): Promise<FBPage> {
  interface Resp { data?: Array<{ id?: string; name?: string; access_token?: string }> }
  const r = await fbProxy<Resp>({
    endpoint: `/${GRAPH_VERSION}/me/accounts`,
    params: { fields: 'id,name,access_token' },
  });
  const page = (r?.data ?? []).find((p) => p.id && p.access_token);
  if (!page) throw new Error('facebook: no managed pages (connect an account that admins a Facebook Page)');
  return { id: page.id!, name: page.name ?? '', access_token: page.access_token! };
}

/**
 * Publish a text post to the first managed Page's feed. Returns the new post
 * id (Graph returns `<page_id>_<post_id>`). The message rides in the POST body
 * (no URL-length ceiling on long copy); the Page token rides as a param.
 */
export async function createPagePost(text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('facebook: empty post text');

  const page = await getFirstManagedPage();
  interface Resp { id?: string }
  const r = await fbProxy<Resp>({
    method: 'POST',
    endpoint: `/${GRAPH_VERSION}/${page.id}/feed`,
    params: { access_token: page.access_token },
    data: { message: body },
  });
  if (!r?.id) throw new Error('facebook: feed API returned no id');
  return r.id;
}

/** True if this tenant has a connected Facebook — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}
