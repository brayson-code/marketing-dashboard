// Instagram integration via Nango. Reads account info + media (posts + reels +
// thumbnails) and recent comments on those posts. Publish path is wired in
// drafts.ts via `publishContent` once IG content drafts gain `platform:'instagram'`.
//
// Important: Instagram Graph API (the live one) only works for Business or
// Creator accounts linked to a Facebook Page. Personal accounts can't be read
// via API — we'll get a "not authorized" error and surface "not connected"
// to the UI. Nango handles the token + refresh.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'instagram';

interface IGConn { connection_id: string; provider_config_key: string }

async function getConn(): Promise<IGConn | null> {
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
  endpoint: string;
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

async function igProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('instagram: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('instagram: not connected for this tenant');
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

export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}

// ── Account headline ────────────────────────────────────────────────────────

export interface IGAccount {
  ig_user_id: string;
  username: string;
  name: string | null;
  profile_picture: string | null;
  media_count: number;
  followers_count: number;
  follows_count: number;
}

/** The connected Instagram Business / Creator account.
 *  Note: under the Graph API the IG user id is the `ig_id` returned by the
 *  /me endpoint when authenticated as a Business account. */
export async function getAccount(): Promise<IGAccount | null> {
  interface Resp { id?: string; username?: string; name?: string; profile_picture_url?: string; media_count?: number; followers_count?: number; follows_count?: number }
  const r = await igProxy<Resp>({
    endpoint: '/v19.0/me',
    params: { fields: 'id,username,name,profile_picture_url,media_count,followers_count,follows_count' },
  });
  if (!r?.id) return null;
  return {
    ig_user_id: r.id,
    username: r.username ?? '',
    name: r.name ?? null,
    profile_picture: r.profile_picture_url ?? null,
    media_count: Number(r.media_count ?? 0),
    followers_count: Number(r.followers_count ?? 0),
    follows_count: Number(r.follows_count ?? 0),
  };
}

// ── Account insights (last 30 days) ─────────────────────────────────────────

export interface IGAccountInsights {
  start: string;
  end: string;
  reach: number;
  impressions: number;
  profile_views: number;
  /** Net follower change inferred from `follower_count` daily series (last − first).
   *  IG Graph reports `follower_count` as a daily delta on day period, summed here. */
  followers_gained: number;
}

interface IGInsightValue { value?: number | Record<string, number>; end_time?: string }
interface IGInsightEntry { name?: string; period?: string; values?: IGInsightValue[] }
interface IGInsightsResp { data?: IGInsightEntry[] }

/** Last-30-day account-level insights for the connected IG business account.
 *  Returns null on failure so the panel can render an empty state instead of
 *  bubbling a 502 to the user. Note: requires a Business or Creator account
 *  with the `instagram_manage_insights` scope on the Nango integration. */
export async function getAccountInsights(): Promise<IGAccountInsights | null> {
  let igUserId: string | null = null;
  try {
    interface MeResp { id?: string }
    const me = await igProxy<MeResp>({ endpoint: '/v19.0/me', params: { fields: 'id' } });
    igUserId = me?.id ?? null;
  } catch {
    return null;
  }
  if (!igUserId) return null;

  // IG insights `since`/`until` are unix seconds; window the last 30 days.
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  const since = Math.floor(start.getTime() / 1000);
  const until = Math.floor(end.getTime() / 1000);

  try {
    const r = await igProxy<IGInsightsResp>({
      endpoint: `/v19.0/${igUserId}/insights`,
      params: {
        metric: 'reach,impressions,profile_views,follower_count',
        period: 'day',
        since,
        until,
      },
    });

    const sumMetric = (name: string): number => {
      const entry = (r?.data ?? []).find((d) => d.name === name);
      if (!entry?.values) return 0;
      let total = 0;
      for (const v of entry.values) {
        if (typeof v.value === 'number') total += v.value;
      }
      return total;
    };

    return {
      start: start.toISOString().slice(0, 10),
      end: end.toISOString().slice(0, 10),
      reach: sumMetric('reach'),
      impressions: sumMetric('impressions'),
      profile_views: sumMetric('profile_views'),
      followers_gained: sumMetric('follower_count'),
    };
  } catch {
    // Most common failure: account isn't Business/Creator, or the insights
    // scope wasn't granted. Surface as null → panel renders "No insights yet".
    return null;
  }
}

// ── Media (posts + reels + carousels) ───────────────────────────────────────

export type IGMediaType = 'IMAGE' | 'VIDEO' | 'CAROUSEL_ALBUM' | 'REELS' | 'STORY';

export interface IGMedia {
  id: string;
  media_type: IGMediaType | string;
  /** Full-resolution media. For VIDEO/REELS this is the video file; for IMAGE
   *  it's the image url. Carousel albums: the cover image url. */
  media_url: string | null;
  /** Best thumbnail for compact cards. For videos this is `thumbnail_url` from
   *  the API; for images we fall back to media_url. */
  thumbnail_url: string | null;
  permalink: string;
  caption: string;
  timestamp: string;
  like_count: number;
  comments_count: number;
}

interface IGMediaItem {
  id: string;
  media_type?: string;
  media_url?: string;
  thumbnail_url?: string;
  permalink?: string;
  caption?: string;
  timestamp?: string;
  like_count?: number;
  comments_count?: number;
}

function mapMedia(x: IGMediaItem): IGMedia {
  const thumb = x.thumbnail_url ?? (x.media_type === 'IMAGE' ? x.media_url ?? null : x.media_url ?? null);
  return {
    id: x.id,
    media_type: x.media_type ?? 'IMAGE',
    media_url: x.media_url ?? null,
    thumbnail_url: thumb,
    permalink: x.permalink ?? `https://www.instagram.com/p/${x.id}/`,
    caption: x.caption ?? '',
    timestamp: x.timestamp ?? '',
    like_count: Number(x.like_count ?? 0),
    comments_count: Number(x.comments_count ?? 0),
  };
}

/** Recent media items on the connected account, newest first. */
export async function listRecentMedia(max = 24): Promise<IGMedia[]> {
  interface Resp { data?: IGMediaItem[] }
  const r = await igProxy<Resp>({
    endpoint: '/v19.0/me/media',
    params: {
      fields: 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count',
      limit: Math.min(max, 100),
    },
  });
  return (r.data ?? []).map(mapMedia);
}

/** Every media item on the connected account, newest first. Paginates 100
 *  items per page; capped by maxPages so a 10k-post account can't drain quota. */
export async function listAllMedia(opts: { maxPages?: number } = {}): Promise<IGMedia[]> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 20, 100));
  const out: IGMedia[] = [];
  let next: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    interface Resp { data?: IGMediaItem[]; paging?: { next?: string; cursors?: { after?: string } } }
    const r = await igProxy<Resp>({
      endpoint: '/v19.0/me/media',
      params: {
        fields: 'id,media_type,media_url,thumbnail_url,permalink,caption,timestamp,like_count,comments_count',
        limit: 100,
        after: next,
      },
    });
    for (const x of r.data ?? []) out.push(mapMedia(x));
    next = r.paging?.cursors?.after;
    if (!next || !r.paging?.next) break;
  }
  return out;
}

// ── Comments ────────────────────────────────────────────────────────────────

export interface IGComment {
  id: string;
  media_id: string;
  username: string;
  text: string;
  timestamp: string;
  like_count: number;
  replies_count: number;
  parent_permalink: string;
}

/** Most-recent comments across the most-recent media items. Instagram doesn't
 *  expose an account-wide comments feed, so we fetch comments per media. We
 *  cap the per-media depth at 25 and total at 50 for quota sanity. */
export async function listRecentComments(maxMedia = 8, perMedia = 6): Promise<IGComment[]> {
  const media = await listRecentMedia(maxMedia);
  const out: IGComment[] = [];
  for (const m of media) {
    try {
      interface Resp { data?: Array<{ id: string; username?: string; text?: string; timestamp?: string; like_count?: number }> }
      const r = await igProxy<Resp>({
        endpoint: `/v19.0/${m.id}/comments`,
        params: { fields: 'id,username,text,timestamp,like_count', limit: perMedia },
      });
      for (const c of r.data ?? []) {
        out.push({
          id: c.id,
          media_id: m.id,
          username: c.username ?? '',
          text: c.text ?? '',
          timestamp: c.timestamp ?? '',
          like_count: Number(c.like_count ?? 0),
          replies_count: 0,
          parent_permalink: m.permalink,
        });
      }
    } catch {
      // Per-media comments call can fail when the media doesn't accept
      // comments — skip it silently rather than aborting the whole list.
    }
  }
  // Newest first across all media.
  return out.sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}

// ── Own-reel insights (Reel Optimizer) ──────────────────────────────────────

export interface IGMediaInsights {
  reach?: number;
  plays?: number;
  saves?: number;
  shares?: number;
  totalInteractions?: number;
  /** Average watch time in SECONDS, derived from total watch time ÷ plays. */
  avgWatchSec?: number;
}

/** Pull the shortcode out of an Instagram reel/post url
 *  (/reel|reels|p|tv/<code>/). Mirrors apify.ts shortcodeOf so a url from either
 *  path matches the same code. Returns null when the url has no shortcode. */
function shortcodeFromUrl(url: string): string | null {
  const m = url.match(/\/(?:reels?|p|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/**
 * Real engagement insights for the owner's OWN reel, matched by shortcode against
 * the connected account's media. Best-effort: returns null on no connection, no
 * shortcode, no matching media, or ANY error — it NEVER throws (the Reel Optimizer
 * scan runs with or without real metrics).
 *
 * Flow: parse the shortcode → page the account's own media → find the item whose
 * permalink contains that shortcode → fetch that media's Graph insights and map
 * reach / plays / saved / shares / total_interactions, plus an avgWatchSec derived
 * from ig_reels_video_view_total_time ÷ plays.
 */
export async function getMediaInsights(reelUrl: string): Promise<IGMediaInsights | null> {
  try {
    const code = shortcodeFromUrl(reelUrl);
    if (!code) return null;

    // Match the reel to one of the connected account's own media items by
    // shortcode in the permalink. listAllMedia returns null/empty paths only
    // when there's no connection (igProxy throws → caught below).
    const media = await listAllMedia({ maxPages: 30 });
    const lower = code.toLowerCase();
    const hit = media.find((m) => (m.permalink || '').toLowerCase().includes(`/${lower}/`))
      ?? media.find((m) => (m.permalink || '').toLowerCase().includes(lower));
    if (!hit) return null;

    // Reel insight metrics. `reach`, `saved`, `shares`, `total_interactions` are
    // single totals; `plays` is the play count; `ig_reels_video_view_total_time`
    // is total watch time in MILLISECONDS, which we turn into an average per play.
    interface InsightVal { value?: number | Record<string, number> }
    interface InsightEntry { name?: string; values?: InsightVal[] }
    interface InsightsResp { data?: InsightEntry[] }
    const resp = await igProxy<InsightsResp>({
      endpoint: `/v19.0/${hit.id}/insights`,
      params: {
        metric: 'reach,plays,saved,shares,total_interactions,ig_reels_video_view_total_time',
      },
    });

    const valueOf = (name: string): number | undefined => {
      const entry = (resp?.data ?? []).find((d) => d.name === name);
      const v = entry?.values?.[0]?.value;
      return typeof v === 'number' ? v : undefined;
    };

    const reach = valueOf('reach');
    const plays = valueOf('plays');
    const saves = valueOf('saved');
    const shares = valueOf('shares');
    const totalInteractions = valueOf('total_interactions');
    const totalWatchMs = valueOf('ig_reels_video_view_total_time');
    const avgWatchSec =
      totalWatchMs != null && plays != null && plays > 0
        ? Math.round((totalWatchMs / plays / 1000) * 10) / 10
        : undefined;

    const out: IGMediaInsights = {};
    if (reach != null) out.reach = reach;
    if (plays != null) out.plays = plays;
    if (saves != null) out.saves = saves;
    if (shares != null) out.shares = shares;
    if (totalInteractions != null) out.totalInteractions = totalInteractions;
    if (avgWatchSec != null) out.avgWatchSec = avgWatchSec;

    // If the Graph call returned nothing usable, treat as no-insights rather than
    // an empty object the caller has to special-case.
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    // No connection, non-Business account, missing insights scope, media that
    // doesn't expose reel insights, or any transient API error — all map to null.
    return null;
  }
}

/** Reply to an IG comment (Graph API). Wired by drafts.publishContent when a
 *  draft is tagged with platform:'instagram_comment' + ig.parent_comment_id. */
export async function replyToComment(parentId: string, text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('instagram: empty reply text');
  interface Resp { id?: string }
  const r = await igProxy<Resp>({
    method: 'POST',
    endpoint: `/v19.0/${parentId}/replies`,
    data: { message: body },
  });
  if (!r?.id) throw new Error('instagram: reply API returned no id');
  return r.id;
}
