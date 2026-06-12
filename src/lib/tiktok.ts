// TikTok integration via Nango (provider 'tiktok' → TikTok Business API,
// business-api.tiktok.com, Open API v1.3). Reads the connected Business
// Account's profile + last-30-day metrics and its recent videos — the
// read-only surface the /analytics TikTok panel needs.
//
// TikTok wraps every payload as { code, message, data } where code !== 0 is an
// error — ttProxy unwraps .data and throws a tagged Error otherwise. Most
// endpoints also require a `business_id` (the TT4B account id bound to the
// OAuth grant): we discover it from Nango's connection record (metadata /
// connection_config / raw token response), fall back to the identity endpoint,
// and cache it in our connections.metadata so later requests skip discovery.

import { getNango, providerConfigKeyFor } from './nango';
import { sql, jsonb } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'tiktok';

interface TTConn {
  connection_id: string;
  provider_config_key: string;
  metadata: Record<string, unknown> | null;
}

/** Look up this tenant's TikTok connection (incl. our cached metadata). Null if not connected. */
async function getConn(): Promise<TTConn | null> {
  const rows = (await sql()`
    SELECT connection_id, provider_config_key, metadata
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER} AND status = 'connected'
    LIMIT 1
  `) as unknown as Array<{ connection_id: string; provider_config_key: string; metadata: Record<string, unknown> | null }>;
  const r = rows[0];
  if (!r?.connection_id) return null;
  return {
    connection_id: r.connection_id,
    provider_config_key: r.provider_config_key || providerConfigKeyFor(PROVIDER),
    metadata: r.metadata ?? null,
  };
}

/** True if this tenant has a connected TikTok — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}

interface ProxyOpts {
  method?: 'GET' | 'POST';
  endpoint: string; // e.g. '/open_api/v1.3/business/get/'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** TikTok's { code, message, data } response envelope. code 0 = OK. */
interface TTEnvelope<T> { code?: number; message?: string; data?: T }

/** Call a TikTok Business API endpoint through the Nango proxy and unwrap the
 *  envelope. Throws a tagged Error on transport failure or code !== 0. */
async function ttProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('tiktok: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('tiktok: not connected for this tenant');

  // Trim empty params — TikTok rejects keys with empty values on some endpoints.
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== '') params[k] = v;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let res: any;
  try {
    res = await nango.proxy({
      method: opts.method ?? 'GET',
      endpoint: opts.endpoint,
      providerConfigKey: conn.provider_config_key,
      connectionId: conn.connection_id,
      params: Object.keys(params).length ? params : undefined,
      data: opts.data,
    });
  } catch (e) {
    // Axios-style failure — surface TikTok's own message when the body has one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (e as any)?.response?.data;
    throw new Error(`tiktok: ${body?.message || (e as Error)?.message || 'request failed'}`);
  }

  const body = res?.data as TTEnvelope<T> | undefined;
  if (body && typeof body.code === 'number' && body.code !== 0) {
    throw new Error(`tiktok: ${body.message || 'API error'} (code ${body.code})`);
  }
  return (body?.data ?? body) as T;
}

// ── Business id discovery ───────────────────────────────────────────────────

/** Keys under which TikTok / Nango may stash the business-account id. */
const ID_KEYS = ['business_id', 'business_account_id', 'open_id', 'creator_id', 'core_user_id', 'user_id'];

function pickId(obj: unknown): string | null {
  if (!obj || typeof obj !== 'object') return null;
  const rec = obj as Record<string, unknown>;
  for (const k of ID_KEYS) {
    const v = rec[k];
    if (typeof v === 'string' && v) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/** Resolve the TT4B business id for this tenant's connection. Order:
 *  1. our connections.metadata cache (also lets an operator pin one in the DB),
 *  2. Nango's connection record (metadata / connection_config / raw token response),
 *  3. the identity endpoint (/user/info/).
 *  Whatever we find is cached back into connections.metadata for next time. */
async function getBusinessId(conn: TTConn): Promise<string> {
  const cached = pickId(conn.metadata);
  if (cached) return cached;

  let found: string | null = null;

  // Nango's view of the connection — TikTok token responses nest the
  // interesting ids under credentials.raw(.data).
  const nango = getNango();
  if (nango) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = await nango.getConnection(conn.provider_config_key, conn.connection_id);
      found =
        pickId(c?.metadata) ??
        pickId(c?.connection_config) ??
        pickId(c?.credentials?.raw?.data) ??
        pickId(c?.credentials?.raw);
    } catch {
      // Best-effort — fall through to the identity endpoint.
    }
  }

  if (!found) {
    try {
      const me = await ttProxy<Record<string, unknown>>({ endpoint: '/open_api/v1.3/user/info/' });
      found = pickId(me);
    } catch {
      // Swallow — we throw one clear error below instead of the raw API noise.
    }
  }

  if (!found) throw new Error('tiktok: could not determine the business account id for this connection');

  // Cache for next time (tenant-scoped — the postgres role bypasses RLS).
  try {
    await sql()`
      UPDATE connections
      SET metadata = COALESCE(metadata, '{}'::jsonb) || ${jsonb({ business_id: found })}
      WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER}
    `;
  } catch {
    // Cache write is an optimization only — never fail the read for it.
  }
  return found;
}

// ── Stats + videos (shapes match tiktok-panel.tsx exactly) ──────────────────

export interface TikTokStats {
  username?: string;
  display_name?: string;
  avatar_url?: string | null;
  follower_count?: number;
  video_views?: number;
  profile_views?: number;
  engagement_rate_pct?: number;
  avg_watch_time_sec?: number;
  start?: string;
  end?: string;
}

export interface TikTokVideo {
  id: string;
  thumbnail_url: string | null;
  permalink: string;
  caption: string;
  views: number;
  likes: number;
  comments: number;
}

/** Coerce TikTok's number-or-numeric-string values; undefined when absent. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Sum a daily-metrics series ({ date, video_views, likes, … }[]) per key. */
function sumSeries(rows: Array<Record<string, unknown>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [k, v] of Object.entries(row)) {
      const n = num(v);
      if (n !== undefined) out[k] = (out[k] ?? 0) + n;
    }
  }
  return out;
}

const STAT_FIELDS = [
  'username', 'display_name', 'profile_image', 'followers_count',
  'video_views', 'profile_views', 'likes', 'comments', 'shares',
  'average_time_watched', 'audience_countries',
];

const VIDEO_FIELDS = [
  'item_id', 'create_time', 'thumbnail_url', 'share_url', 'embed_url',
  'caption', 'video_views', 'likes', 'comments', 'shares',
];

interface BusinessGetData {
  username?: string;
  display_name?: string;
  profile_image?: string;
  followers_count?: number | string;
  video_views?: number | string;
  profile_views?: number | string;
  likes?: number | string;
  comments?: number | string;
  shares?: number | string;
  average_time_watched?: number | string;
  /** Daily series when a date range is requested (plan-tier dependent). */
  metrics?: Array<Record<string, unknown>>;
}

interface VideoListData {
  videos?: Array<{
    item_id?: string;
    thumbnail_url?: string;
    share_url?: string;
    embed_url?: string;
    caption?: string;
    video_views?: number | string;
    likes?: number | string;
    comments?: number | string;
  }>;
}

/** Account profile + last-30-day metrics + recent videos for the connected
 *  TikTok Business account, in exactly the shape the analytics panel renders.
 *  Stats failing throws (the route surfaces the error); videos failing
 *  degrades to an empty list — a partial panel beats a dead one. */
export async function getOverview(): Promise<{ stats: TikTokStats; videos: TikTokVideo[] }> {
  const conn = await getConn();
  if (!conn) throw new Error('tiktok: not connected for this tenant');
  const businessId = await getBusinessId(conn);

  // 30-day window incl. today, as YYYY-MM-DD (what business/get expects).
  const endD = new Date();
  const startD = new Date(endD.getTime() - 29 * 86400_000);
  const day = (d: Date) => d.toISOString().slice(0, 10);

  const d = await ttProxy<BusinessGetData>({
    endpoint: '/open_api/v1.3/business/get/',
    params: {
      business_id: businessId,
      fields: JSON.stringify(STAT_FIELDS),
      start_date: day(startD),
      end_date: day(endD),
    },
  });

  // Windowed metrics come back as a daily series under .metrics on some plan
  // tiers and as flat totals on others — prefer the summed series when present.
  const daily = Array.isArray(d?.metrics) ? d.metrics : null;
  const series = daily ? sumSeries(daily) : {};
  const views = series.video_views ?? num(d?.video_views);
  const likes = series.likes ?? num(d?.likes);
  const comments = series.comments ?? num(d?.comments);
  const shares = series.shares ?? num(d?.shares);
  // Watch time is an average, not a count — mean the daily values instead of summing.
  const avgWatch = daily && daily.length > 0 && series.average_time_watched !== undefined
    ? series.average_time_watched / daily.length
    : num(d?.average_time_watched);

  const stats: TikTokStats = {
    username: d?.username || undefined,
    display_name: d?.display_name || undefined,
    avatar_url: d?.profile_image ?? null,
    follower_count: num(d?.followers_count) ?? 0,
    video_views: views ?? 0,
    profile_views: series.profile_views ?? num(d?.profile_views) ?? 0,
    start: day(startD),
    end: day(endD),
  };
  if (avgWatch !== undefined) stats.avg_watch_time_sec = avgWatch;

  // engagement = (likes+comments+shares) ÷ views — only when the pieces exist.
  if (views !== undefined && views > 0 && (likes !== undefined || comments !== undefined || shares !== undefined)) {
    stats.engagement_rate_pct = (((likes ?? 0) + (comments ?? 0) + (shares ?? 0)) / views) * 100;
  }

  let videos: TikTokVideo[] = [];
  try {
    videos = await listRecentVideos(businessId, stats.username);
  } catch {
    // Video list is decorative next to the headline stats — degrade to empty.
  }
  return { stats, videos };
}

/** Recent videos on the connected Business account, mapped for the panel. */
export async function listRecentVideos(businessId: string, username?: string, max = 10): Promise<TikTokVideo[]> {
  const d = await ttProxy<VideoListData>({
    endpoint: '/open_api/v1.3/business/video/list/',
    params: {
      business_id: businessId,
      fields: JSON.stringify(VIDEO_FIELDS),
      max_count: Math.min(max, 20),
    },
  });
  return (d?.videos ?? [])
    .filter((v) => !!v.item_id)
    .map((v) => ({
      id: String(v.item_id),
      thumbnail_url: v.thumbnail_url ?? null,
      // share_url is canonical when TikTok returns it; otherwise build the
      // public permalink (TikTok resolves @user/video/<id> by the video id).
      permalink: v.share_url || v.embed_url || `https://www.tiktok.com/@${username ?? ''}/video/${v.item_id}`,
      caption: v.caption ?? '',
      views: num(v.video_views) ?? 0,
      likes: num(v.likes) ?? 0,
      comments: num(v.comments) ?? 0,
    }));
}
