// YouTube integration via Nango. Reads channel stats + recent videos + recent
// top-level comments, and posts approved reply text back. Video uploads are
// NOT supported here (no video pipeline today); this is the text-and-numbers
// surface that the channel connection actually unlocks.
//
// Nango handles the OAuth token + refresh — we never see the access token
// directly. Failures bubble up with a tagged error so callers can decide
// whether to surface "YouTube hiccupped" vs the actual API message.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'youtube';

interface YTConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's YouTube connection. Null if not connected. */
async function getConn(): Promise<YTConn | null> {
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
  endpoint: string;             // e.g. '/youtube/v3/channels'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** Call a YouTube endpoint through the Nango proxy. Throws a tagged Error on
 *  any failure so callers can show "YouTube is unreachable" vs. their own error. */
async function ytProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('youtube: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('youtube: not connected for this tenant');

  // Trim undefined params — YouTube rejects keys with empty values on some endpoints.
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== '') params[k] = v;

  // The Nango SDK proxy returns an axios-like response { data, status, … }.
  // We surface .data so callers get the parsed JSON directly.
  // Typed loosely because YouTube responses vary widely; per-call helpers cast.
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

// ── Public reads ────────────────────────────────────────────────────────────

export interface YTChannelStats {
  channel_id: string;
  title: string;
  thumb: string | null;
  subscribers: number;
  views_total: number;
  videos_total: number;
}

/** The connected channel's headline stats (subs / views / videos). */
export async function getChannelStats(): Promise<YTChannelStats | null> {
  interface Resp { items?: Array<{ id: string; snippet?: { title?: string; thumbnails?: { default?: { url?: string } } }; statistics?: { subscriberCount?: string; viewCount?: string; videoCount?: string } }> }
  const r = await ytProxy<Resp>({
    endpoint: '/youtube/v3/channels',
    params: { part: 'snippet,statistics', mine: 'true' },
  });
  const c = r.items?.[0];
  if (!c) return null;
  return {
    channel_id: c.id,
    title: c.snippet?.title ?? '',
    thumb: c.snippet?.thumbnails?.default?.url ?? null,
    subscribers: Number(c.statistics?.subscriberCount ?? 0),
    views_total: Number(c.statistics?.viewCount ?? 0),
    videos_total: Number(c.statistics?.videoCount ?? 0),
  };
}

export interface YTThumbs {
  default: string | null;
  medium: string | null;
  high: string | null;
  standard: string | null;
  maxres: string | null;
}

export interface YTVideo {
  id: string;
  title: string;
  description: string;
  published_at: string;
  /** Pre-picked best thumbnail (medium → default) for compact cards. */
  thumb: string | null;
  /** All thumbnail variants returned by the API — use the largest your layout needs. */
  thumbs: YTThumbs;
  duration_iso: string | null; // ISO-8601 duration (PT2M30S etc.)
  views: number;
  likes: number;
  comments: number;
  url: string;
}

interface YTVideoSnippet { title?: string; description?: string; publishedAt?: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string }; standard?: { url?: string }; maxres?: { url?: string } } }
interface YTVideoStats { viewCount?: string; likeCount?: string; commentCount?: string }
interface YTVideoCD { duration?: string }
interface YTVideoItem { id: string; snippet?: YTVideoSnippet; statistics?: YTVideoStats; contentDetails?: YTVideoCD }

function mapVideo(x: YTVideoItem): YTVideo {
  const t = x.snippet?.thumbnails ?? {};
  const thumbs: YTThumbs = {
    default: t.default?.url ?? null,
    medium:  t.medium?.url  ?? null,
    high:    t.high?.url    ?? null,
    standard:t.standard?.url?? null,
    maxres:  t.maxres?.url  ?? null,
  };
  return {
    id: x.id,
    title: x.snippet?.title ?? '',
    description: x.snippet?.description ?? '',
    published_at: x.snippet?.publishedAt ?? '',
    thumb: thumbs.medium ?? thumbs.default ?? thumbs.high ?? null,
    thumbs,
    duration_iso: x.contentDetails?.duration ?? null,
    views: Number(x.statistics?.viewCount ?? 0),
    likes: Number(x.statistics?.likeCount ?? 0),
    comments: Number(x.statistics?.commentCount ?? 0),
    url: `https://www.youtube.com/watch?v=${x.id}`,
  };
}

/** Fetch the uploads playlist id for the connected channel. Cached for the
 *  lifetime of the request only — pagination calls share the same lookup. */
async function getUploadsPlaylistId(): Promise<string | null> {
  interface ChResp { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }
  const ch = await ytProxy<ChResp>({
    endpoint: '/youtube/v3/channels',
    params: { part: 'contentDetails', mine: 'true' },
  });
  return ch.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null;
}

/** Recent uploads on the connected channel, newest first. */
export async function listRecentVideos(max = 10): Promise<YTVideo[]> {
  const uploads = await getUploadsPlaylistId();
  if (!uploads) return [];

  interface PIResp { items?: Array<{ contentDetails?: { videoId?: string } }> }
  const pi = await ytProxy<PIResp>({
    endpoint: '/youtube/v3/playlistItems',
    params: { part: 'contentDetails', playlistId: uploads, maxResults: Math.min(max, 50) },
  });
  const ids = (pi.items ?? []).map((x) => x.contentDetails?.videoId).filter((x): x is string => !!x);
  if (ids.length === 0) return [];

  interface VResp { items?: YTVideoItem[] }
  const v = await ytProxy<VResp>({
    endpoint: '/youtube/v3/videos',
    params: { part: 'snippet,statistics,contentDetails', id: ids.join(',') },
  });
  return (v.items ?? []).map(mapVideo);
}

/** Every video on the connected channel, newest first. Paginates the uploads
 *  playlist in 50-video pages and batches videos.list in 50-id chunks.
 *  Capped by `maxPages` so a 10k-video channel can't accidentally drain quota. */
export async function listAllVideos(opts: { maxPages?: number } = {}): Promise<YTVideo[]> {
  const maxPages = Math.max(1, Math.min(opts.maxPages ?? 20, 100)); // up to ~5,000 videos
  const uploads = await getUploadsPlaylistId();
  if (!uploads) return [];

  // 1) walk the uploads playlist collecting all video ids.
  const ids: string[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page++) {
    interface PIResp { items?: Array<{ contentDetails?: { videoId?: string } }>; nextPageToken?: string }
    const pi = await ytProxy<PIResp>({
      endpoint: '/youtube/v3/playlistItems',
      params: { part: 'contentDetails', playlistId: uploads, maxResults: 50, pageToken },
    });
    for (const x of pi.items ?? []) {
      const id = x.contentDetails?.videoId;
      if (id) ids.push(id);
    }
    if (!pi.nextPageToken) break;
    pageToken = pi.nextPageToken;
  }
  if (ids.length === 0) return [];

  // 2) batched videos.list — 50 ids per call.
  const out: YTVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    interface VResp { items?: YTVideoItem[] }
    const v = await ytProxy<VResp>({
      endpoint: '/youtube/v3/videos',
      params: { part: 'snippet,statistics,contentDetails', id: chunk.join(',') },
    });
    for (const x of v.items ?? []) out.push(mapVideo(x));
  }
  return out;
}

export interface YTComment {
  id: string;                    // top-level comment id (= thread id for top-level)
  video_id: string;
  author: string;
  author_thumb: string | null;
  text: string;
  published_at: string;
  like_count: number;
  reply_count: number;
}

/** Recent top-level comments across the connected channel, newest first.
 *  Used by the Inbox to surface what's awaiting a reply. */
export async function listRecentComments(max = 20): Promise<YTComment[]> {
  interface Resp { items?: Array<{ id: string; snippet?: { videoId?: string; totalReplyCount?: number; topLevelComment?: { id?: string; snippet?: { authorDisplayName?: string; authorProfileImageUrl?: string; textDisplay?: string; publishedAt?: string; likeCount?: number } } } }> }
  const r = await ytProxy<Resp>({
    endpoint: '/youtube/v3/commentThreads',
    params: { part: 'snippet', allThreadsRelatedToChannel: 'true', maxResults: Math.min(max, 100), order: 'time', textFormat: 'plainText' },
  });
  return (r.items ?? []).map((t) => {
    const top = t.snippet?.topLevelComment;
    return {
      id: top?.id ?? t.id,
      video_id: t.snippet?.videoId ?? '',
      author: top?.snippet?.authorDisplayName ?? '',
      author_thumb: top?.snippet?.authorProfileImageUrl ?? null,
      text: top?.snippet?.textDisplay ?? '',
      published_at: top?.snippet?.publishedAt ?? '',
      like_count: Number(top?.snippet?.likeCount ?? 0),
      reply_count: Number(t.snippet?.totalReplyCount ?? 0),
    };
  });
}

/** Post a reply to a top-level comment. Returns the new reply id on success.
 *  Used by the Drafts approve-publish path for YouTube replies. */
export async function replyToComment(parentId: string, text: string): Promise<string> {
  const body = text.trim();
  if (!body) throw new Error('youtube: empty reply text');
  interface Resp { id?: string; snippet?: { textDisplay?: string } }
  const r = await ytProxy<Resp>({
    method: 'POST',
    endpoint: '/youtube/v3/comments',
    params: { part: 'snippet' },
    data: { snippet: { parentId, textOriginal: body } },
  });
  if (!r?.id) throw new Error('youtube: reply API returned no id');
  return r.id;
}

// ── Analytics (last 30 days) ────────────────────────────────────────────────

export interface YT30DayMetrics {
  start: string;                 // YYYY-MM-DD
  end: string;
  views: number;
  estimated_minutes_watched: number;
  average_view_duration_sec: number;
  subscribers_gained: number;
  subscribers_lost: number;
  net_subs: number;
}

/** Last 30 days of channel-level analytics. Uses the YouTube Analytics API
 *  (separate from the Data API) — requires the yt-analytics.readonly scope on
 *  the OAuth grant. Returns null if the scope is missing or the call fails. */
export async function last30DayMetrics(): Promise<YT30DayMetrics | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 29 * 86400_000); // 30-day window incl. today
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  try {
    interface Resp { rows?: Array<Array<number>> }
    const r = await ytProxy<Resp>({
      endpoint: '/v2/reports',
      // Nango's YouTube provider config routes the Analytics API host correctly
      // when the endpoint is supplied with the v2 prefix.
      params: {
        ids: 'channel==MINE',
        startDate: fmt(start),
        endDate: fmt(end),
        metrics: 'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost',
      },
    });
    const row = r.rows?.[0];
    if (!row || row.length < 5) return null;
    const [views, watched, avgDur, gained, lost] = row;
    return {
      start: fmt(start), end: fmt(end),
      views: Number(views ?? 0),
      estimated_minutes_watched: Number(watched ?? 0),
      average_view_duration_sec: Number(avgDur ?? 0),
      subscribers_gained: Number(gained ?? 0),
      subscribers_lost: Number(lost ?? 0),
      net_subs: Number(gained ?? 0) - Number(lost ?? 0),
    };
  } catch (e) {
    console.error('[youtube] last30DayMetrics failed:', (e as Error).message);
    return null;
  }
}

/** True if this tenant has a connected YouTube — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}
