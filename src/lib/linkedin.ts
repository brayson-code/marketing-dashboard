// LinkedIn integration. Two halves, two auth models:
//
//  1. Publishing (createPost) — via Nango OAuth, posts approved content_post
//     drafts to the connected MEMBER's feed using the versioned Posts API
//     (/rest/posts). Organization-page posting needs the Marketing Developer
//     Platform approval and an org URN — not wired yet.
//  2. Org analytics (fetchLinkedInOrgAnalytics, legacy) — direct access-token
//     fetcher used by /api/analytics; predates the Nango connection and keeps
//     working off a pasted token.
//
// Nango handles the OAuth token + refresh — we never see the access token.
// Publish failures bubble up with a tagged 'linkedin: …' error so
// drafts.publishContent can surface the real cause instead of a fake success.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

// ── Publishing via Nango ────────────────────────────────────────────────────

const PROVIDER = 'linkedin';

/** LinkedIn versioned-API month. Bump deliberately — each version is supported
 *  for ~1 year and request/response shapes can change between versions. */
const LINKEDIN_VERSION = '202506';

interface LIConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's LinkedIn connection. Null if not connected. */
async function getConn(): Promise<LIConn | null> {
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
  endpoint: string;             // e.g. '/rest/posts'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
  headers?: Record<string, string>;
}

interface RawResponse {
  data: unknown;
  headers: Record<string, unknown>;
}

/** Call a LinkedIn endpoint through the Nango proxy, returning BOTH body and
 *  response headers — the Posts API reports the created post's URN in the
 *  `x-restli-id` header with an empty body. Throws tagged errors. */
async function liProxyRaw(opts: ProxyOpts): Promise<RawResponse> {
  const nango = getNango();
  if (!nango) throw new Error('linkedin: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('linkedin: not connected for this tenant');

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
    headers: opts.headers,
  });
  return { data: res?.data, headers: (res?.headers ?? {}) as Record<string, unknown> };
}

/** Case-insensitive response-header lookup — axios lowercases header names but
 *  we don't bet correctness on that. */
function headerValue(headers: Record<string, unknown>, name: string): string | null {
  const want = name.toLowerCase();
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (k.toLowerCase() === want && typeof v === 'string' && v) return v;
  }
  // Some transports hand back a Headers-like object instead of a plain record.
  const h = headers as unknown as { get?: (n: string) => string | null };
  if (typeof h?.get === 'function') {
    const v = h.get(name);
    if (v) return v;
  }
  return null;
}

/**
 * The `commentary` field uses LinkedIn's "Little Text" format, where these
 * characters are control characters. Escape them so literal parens/brackets
 * in marketing copy render as written instead of 400ing or becoming markup.
 */
function escapeLittleText(s: string): string {
  return s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);
}

/** Resolve the connected member's URN id via OpenID userinfo (`sub`). */
async function getMemberSub(): Promise<string> {
  interface Resp { sub?: string }
  const res = await liProxyRaw({ endpoint: '/v2/userinfo' });
  const sub = (res.data as Resp | undefined)?.sub;
  if (!sub) throw new Error('linkedin: userinfo returned no sub (is the OpenID Connect scope granted?)');
  return sub;
}

/**
 * Publish a text post to the connected member's feed. Returns the new post's
 * URN (e.g. urn:li:share:123…). LinkedIn returns 201 with an EMPTY body and
 * the URN in the `x-restli-id` response header — we check the header first,
 * then fall back to a body `id` in case a future version inlines it.
 */
export async function createPost(text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('linkedin: empty post text');

  const sub = await getMemberSub();
  const res = await liProxyRaw({
    method: 'POST',
    endpoint: '/rest/posts',
    headers: {
      'LinkedIn-Version': LINKEDIN_VERSION,
      'X-Restli-Protocol-Version': '2.0.0',
      'Content-Type': 'application/json',
    },
    data: {
      author: `urn:li:person:${sub}`,
      commentary: escapeLittleText(body),
      visibility: 'PUBLIC',
      // targetEntities / thirdPartyDistributionChannels are required keys even
      // when empty — omitting them is a 400 on current API versions.
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  });

  const headerUrn = headerValue(res.headers, 'x-restli-id');
  if (headerUrn) return headerUrn;
  const data = res.data as { id?: string } | undefined;
  if (data?.id) return data.id;
  throw new Error('linkedin: post API returned no id (checked x-restli-id header and body)');
}

/** True if this tenant has a connected LinkedIn — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}

// ── Org analytics (legacy direct-token path, used by /api/analytics) ───────

export interface LinkedInSummary {
  organizationUrn: string;
  followers?: number;
  impressions?: number;
  clicks?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  engagementRatePct?: number;
}

export interface LinkedInSeriesPoint {
  date: string; // YYYY-MM-DD
  impressions: number;
  clicks: number;
  likes: number;
  comments: number;
  shares: number;
}

interface LinkedInShareElement {
  timeRange?: { start?: number };
  totalShareStatistics?: Record<string, unknown>;
  shareStatistics?: Record<string, unknown>;
  total?: Record<string, unknown>;
}

interface LinkedInFollowerStatsResponse {
  elements?: Array<Record<string, unknown>>;
}

interface LinkedInShareStatsResponse {
  totalShareStatistics?: Record<string, unknown>;
  elements?: LinkedInShareElement[];
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function isLinkedInSeriesPoint(value: LinkedInSeriesPoint | null): value is LinkedInSeriesPoint {
  return value !== null;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

async function liGet<T>(opts: {
  accessToken: string;
  url: string;
  version?: string;
}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${opts.accessToken}`,
    "X-Restli-Protocol-Version": "2.0.0",
  };
  if (opts.version) headers["LinkedIn-Version"] = opts.version;

  const res = await fetch(opts.url, { headers, cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LinkedIn API failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

export async function fetchLinkedInOrgAnalytics(opts: {
  accessToken: string;
  organizationUrn: string;
  version?: string;
}): Promise<{ summary: LinkedInSummary; series: LinkedInSeriesPoint[] }> {
  let followers: number | undefined;
  try {
    const followerStats = await liGet<LinkedInFollowerStatsResponse>({
      accessToken: opts.accessToken,
      version: opts.version,
      url:
        "https://api.linkedin.com/rest/organizationalEntityFollowerStatistics?" +
        new URLSearchParams({
          q: "organizationalEntity",
          organizationalEntity: opts.organizationUrn,
        }).toString(),
    });

    const el = Array.isArray(followerStats?.elements) ? followerStats.elements[0] : null;
    const followerCounts = asRecord(el?.followerCounts);
    const fc =
      followerCounts.organicFollowerCount ??
      followerCounts.paidFollowerCount ??
      followerCounts.totalFollowerCount ??
      el?.followerCount;
    const parsed = num(fc);
    if (parsed > 0) followers = parsed;
  } catch {
    // ignore
  }

  const shareStats = await liGet<LinkedInShareStatsResponse>({
    accessToken: opts.accessToken,
    version: opts.version,
    url:
      "https://api.linkedin.com/rest/organizationalEntityShareStatistics?" +
      new URLSearchParams({
        q: "organizationalEntity",
        organizationalEntity: opts.organizationUrn,
      }).toString(),
  });

  const total = shareStats?.totalShareStatistics ?? shareStats?.elements?.[0]?.totalShareStatistics;
  const impressions = num(total?.impressionCount ?? total?.impressions);
  const clicks = num(total?.clickCount ?? total?.clicks);
  const likes = num(total?.likeCount ?? total?.likes);
  const comments = num(total?.commentCount ?? total?.comments);
  const shares = num(total?.shareCount ?? total?.shares);
  const engagementRatePct = impressions > 0 ? ((clicks + likes + comments + shares) / impressions) * 100 : 0;

  const series: LinkedInSeriesPoint[] = Array.isArray(shareStats?.elements)
    ? shareStats.elements
        .map((e) => {
          const startMs = e?.timeRange?.start as number | undefined;
          const date =
            typeof startMs === "number" && Number.isFinite(startMs)
              ? new Date(startMs).toISOString().slice(0, 10)
              : null;
          if (!date) return null;
          const stats = e?.totalShareStatistics ?? e?.shareStatistics ?? e?.total ?? {};
          return {
            date,
            impressions: num(stats?.impressionCount ?? stats?.impressions),
            clicks: num(stats?.clickCount ?? stats?.clicks),
            likes: num(stats?.likeCount ?? stats?.likes),
            comments: num(stats?.commentCount ?? stats?.comments),
            shares: num(stats?.shareCount ?? stats?.shares),
          };
        })
        .filter(isLinkedInSeriesPoint)
    : [];

  return {
    summary: {
      organizationUrn: opts.organizationUrn,
      followers,
      impressions,
      clicks,
      likes,
      comments,
      shares,
      engagementRatePct,
    },
    series,
  };
}
