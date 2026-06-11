// Apify — Instagram reel/post scraping for accounts WE don't own (competitor
// research, trend mining, inspiration). Unlike instagram.ts (which reads the
// tenant's OWN connected Business account via the Graph API), this scrapes any
// public IG handle or permalink through a maintained Apify actor.
//
// BYO key: each tenant pastes their Apify token in Connections (stored AES-256
// encrypted, scoped to tenant_id — see integrations-store.ts). Falls back to
// APIFY_TOKEN (env) for the owner/HQ tenant + local testing. Mirrors the key
// pattern in agentmail.ts getAgentMailKey().
//
// Endpoint: Apify's run-sync-get-dataset-items runs an actor synchronously and
// returns the dataset items array DIRECTLY (no {data} wrapper). Actor item
// fields vary by actor/version, so every field is coalesced defensively — a
// missing field never throws.

import { getDecryptedSecret } from './integrations-store';

// Default to a well-known maintained Instagram scraper; override per-deploy via
// APIFY_ACTOR. Apify actor ids use '~' between owner and name in the URL path.
const DEFAULT_ACTOR = 'apify~instagram-scraper';
const BASE = 'https://api.apify.com/v2';

/** Normalized reel/post shape consumed by the rest of the app. Numeric metrics
 *  are null (not 0) when the actor didn't return them, so callers can tell
 *  "zero views" apart from "unknown". */
export interface ReelData {
  externalId: string;
  url: string;
  caption: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  postedAt: number | null; // epoch seconds
  thumbnailUrl: string | null;
  videoUrl: string | null;
  subtitles: string | null;
  handle: string | null; // the reel owner's IG username (no @)
}

/** The Apify token for the CURRENT tenant: their pasted key first, then the env
 *  fallback (owner/HQ + local testing). Null when neither is set. Relies on the
 *  caller having entered tenant context (enterTenant). */
export async function getApifyKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('apify');
    const tenantKey = secret?.api_key?.trim();
    if (tenantKey) return tenantKey;
  } catch {
    /* fall through to env */
  }
  const envKey = process.env.APIFY_TOKEN?.trim();
  return envKey || null;
}

function actorId(): string {
  return process.env.APIFY_ACTOR?.trim() || DEFAULT_ACTOR;
}

/** Run the configured actor synchronously and return its dataset items array.
 *  run-sync-get-dataset-items returns the items array directly (no wrapper). */
async function runActor(input: unknown): Promise<RawItem[]> {
  const key = await getApifyKey();
  if (!key) throw new Error('apify: no API key for this tenant');
  const url = `${BASE}/acts/${actorId()}/run-sync-get-dataset-items?token=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`apify ${res.status}: ${txt.slice(0, 200)}`);
  }
  const items = (await res.json().catch(() => [])) as unknown;
  return Array.isArray(items) ? (items as RawItem[]) : [];
}

// Actor item fields vary across actors/versions; everything is optional and read
// defensively in mapItem. Common aliases for the instagram-scraper family are
// covered (id/shortCode, videoViewCount/videoPlayCount, etc.).
interface RawItem {
  id?: string;
  shortCode?: string;
  shortcode?: string;
  code?: string;
  pk?: string | number;
  url?: string;
  permalink?: string;
  caption?: string;
  text?: string;
  title?: string;
  videoViewCount?: number;
  videoPlayCount?: number;
  viewCount?: number;
  views?: number;
  playCount?: number;
  likesCount?: number;
  likeCount?: number;
  likes?: number;
  commentsCount?: number;
  commentCount?: number;
  comments?: number;
  timestamp?: string | number;
  takenAt?: string | number;
  taken_at?: string | number;
  takenAtTimestamp?: number;
  displayUrl?: string;
  displayResourceUrl?: string;
  thumbnailUrl?: string;
  imageUrl?: string;
  videoUrl?: string;
  videoUrlFallback?: string;
  subtitles?: string;
  captionTranscript?: string;
  ownerUsername?: string;
  username?: string;
  owner?: { username?: string };
}

// Pick the first defined value from a list of possible field aliases.
function firstDefined<T>(...vals: (T | undefined | null)[]): T | null {
  for (const v of vals) if (v !== undefined && v !== null) return v;
  return null;
}

// Coerce to a finite number, else null (preserves "unknown" vs 0).
function num(...vals: (number | string | undefined | null)[]): number | null {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    const n = typeof v === 'number' ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Coerce an actor timestamp (ISO string OR epoch seconds/ms) to epoch SECONDS.
function epochSec(...vals: (string | number | undefined | null)[]): number | null {
  for (const v of vals) {
    if (v === undefined || v === null || v === '') continue;
    if (typeof v === 'number' && Number.isFinite(v)) {
      // Heuristic: >1e12 looks like ms, else already seconds.
      return Math.floor(v > 1e12 ? v / 1000 : v);
    }
    const s = String(v);
    const asNum = Number(s);
    if (Number.isFinite(asNum) && /^\d+$/.test(s.trim())) {
      return Math.floor(asNum > 1e12 ? asNum / 1000 : asNum);
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) return Math.floor(parsed / 1000);
  }
  return null;
}

/** Map a raw actor item into ReelData. Never throws on a missing field —
 *  unknown fields coalesce to null (numbers) or '' (caption/externalId/url). */
function mapItem(x: RawItem): ReelData {
  let code = firstDefined(x.shortCode, x.shortcode, x.code, x.id, x.pk != null ? String(x.pk) : null);
  const url = firstDefined(x.url, x.permalink, code ? `https://www.instagram.com/reel/${code}/` : null) ?? '';
  // Fall back to the permalink's shortcode (/reel|reels|p|tv/<code>/) so a reel
  // always gets a STABLE external_id. Without this, an item missing every id
  // alias would upsert under external_id=null and INSERT a duplicate row on every
  // watchlist sweep (UNIQUE treats NULLs as distinct).
  if (code == null && url) {
    const m = url.match(/\/(?:reels?|p|tv)\/([^/?#]+)/i);
    if (m) code = m[1];
  }
  // Last resort: key on the full permalink so the reel still gets a STABLE,
  // dedup-able external_id (UNIQUE treats NULLs as distinct, which would let an
  // id-less item INSERT a fresh duplicate — and re-analyze — on every sweep).
  const externalId = code != null ? String(code) : (url || '');
  return {
    externalId,
    url,
    caption: firstDefined(x.caption, x.text, x.title) ?? '',
    views: num(x.videoViewCount, x.videoPlayCount, x.viewCount, x.views, x.playCount),
    likes: num(x.likesCount, x.likeCount, x.likes),
    comments: num(x.commentsCount, x.commentCount, x.comments),
    postedAt: epochSec(x.timestamp, x.takenAt, x.taken_at, x.takenAtTimestamp),
    thumbnailUrl: firstDefined(x.displayUrl, x.displayResourceUrl, x.thumbnailUrl, x.imageUrl),
    videoUrl: firstDefined(x.videoUrl, x.videoUrlFallback),
    subtitles: firstDefined(x.subtitles, x.captionTranscript),
    handle: (firstDefined(x.ownerUsername, x.owner?.username, x.username) ?? '').replace(/^@/, '') || null,
  };
}

/** Scrape a single reel/post by its permalink. Returns a best-effort ReelData;
 *  caption/metrics may be null if the actor didn't surface them. Throws if the
 *  actor returns no items (e.g. private/removed post). */
export async function scrapeReel(url: string): Promise<ReelData> {
  const items = await runActor({ directUrls: [url], resultsType: 'posts', resultsLimit: 1 });
  const first = items[0];
  if (!first) throw new Error(`apify: no reel data returned for ${url}`);
  return mapItem(first);
}

/** Recent reels/posts for a public IG handle (default 12). Returns [] when the
 *  actor finds nothing (private account / no posts) rather than throwing. */
export async function scrapeProfileReels(handle: string, limit = 12): Promise<ReelData[]> {
  const username = handle.trim().replace(/^@/, '');
  const items = await runActor({ username: [username], resultsType: 'posts', resultsLimit: limit });
  return items.map(mapItem);
}

function shortcodeOf(url: string): string | null {
  const m = url.match(/\/(?:reels?|p|tv)\/([^/?#]+)/i);
  return m ? m[1] : null;
}

/** Scrape MANY reels in ONE actor run — one boot, one charge, all at once —
 *  instead of N separate scrapeReel calls. Maps each returned item back to its
 *  requested url by shortcode so the order is stable; urls the actor couldn't
 *  fetch are simply absent from the result. */
export async function scrapeReels(urls: string[]): Promise<ReelData[]> {
  const clean = Array.from(new Set(urls.map((u) => u.trim()).filter(Boolean)));
  if (clean.length === 0) return [];
  if (clean.length === 1) return [await scrapeReel(clean[0])];
  const items = await runActor({ directUrls: clean, resultsType: 'posts', resultsLimit: clean.length });
  const mapped = items.map(mapItem);
  const byCode = new Map<string, ReelData>();
  for (const r of mapped) {
    const code = shortcodeOf(r.url) ?? (r.externalId || null);
    if (code) byCode.set(code, r);
  }
  const ordered: ReelData[] = [];
  for (const u of clean) {
    const hit = (shortcodeOf(u) && byCode.get(shortcodeOf(u)!)) || null;
    if (hit) ordered.push(hit);
  }
  return ordered.length ? ordered : mapped;
}

// Walk a parsed JSON value for the first finite number found at any of the given
// dot-path keys (case-insensitive leaf match), then any nested numeric field that
// looks USD-ish. Used to read spend defensively across Apify response shapes.
function pickNumberDeep(obj: unknown, keys: string[]): number | null {
  if (obj == null || typeof obj !== 'object') return null;
  const wanted = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (wanted.includes(k.toLowerCase())) {
      const n = typeof v === 'number' ? v : Number(v);
      if (Number.isFinite(n)) return n;
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === 'object') {
      const nested = pickNumberDeep(v, keys);
      if (nested != null) return nested;
    }
  }
  return null;
}

/** Month-to-date Apify spend (USD) + the account's plan id for the CURRENT
 *  tenant. Returns null when there's no key. Never throws — any fetch/parse miss
 *  yields nulls so the spend route can render partial data. */
export async function getApifyUsage(): Promise<{ usedUsd: number | null; plan: string | null } | null> {
  const key = await getApifyKey();
  if (!key) return null;

  let usedUsd: number | null = null;
  let plan: string | null = null;

  // Monthly usage → a USD total. Field names drift across Apify API versions, so
  // pull the first USD-looking number we can find at the known keys.
  try {
    const res = await fetch(
      `${BASE}/users/me/usage/monthly?token=${encodeURIComponent(key)}`,
    );
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
      const data = body?.data ?? body;
      usedUsd = pickNumberDeep(data, [
        'totalUsageCreditsUsdBeforeVolumeDiscount',
        'totalUsageCreditsUsd',
        'monthlyServiceUsageUsd',
        'usdTotal',
        'usd',
      ]);
    }
  } catch {
    /* leave usedUsd null */
  }

  // Account → plan id.
  try {
    const res = await fetch(`${BASE}/users/me?token=${encodeURIComponent(key)}`);
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as
        | { data?: { plan?: { id?: unknown } } }
        | null;
      const id = body?.data?.plan?.id;
      if (typeof id === 'string' && id) plan = id;
    }
  } catch {
    /* leave plan null */
  }

  return { usedUsd, plan };
}
