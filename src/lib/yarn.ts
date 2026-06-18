// Yarn (getyarn.io) clip search + download — the "movie-quote cutaway" source.
//
// getyarn.io and its CDN (y.yarn.co) sit behind Cloudflare, which fingerprints
// the TLS handshake (JA3) — a plain fetch/curl gets a 403 challenge page. We get
// through with `impit` (Apify's Rust client built on a patched rustls) using a
// real Chrome TLS fingerprint, exactly the trick `curl_cffi impersonate=chrome`
// uses in the reference tools. Optionally routes through a residential proxy
// (e.g. Apify Proxy) when Vercel's datacenter IP is itself challenged.
//
// Search recipe (from getyarn's public HTML): the yarn-find page embeds clip
// links `yarn-clip/{uuid}`; the playable MP4 is `https://y.yarn.co/{uuid}.mp4`.
//
// This module is intentionally dependency-light and side-effect-free: it only
// fetches + parses. Persisting a clip into the media library (Blob + createAsset)
// and trimming to a sub-second cutaway live in the API layer.

import { Impit } from 'impit';

const SEARCH_BASE = 'https://getyarn.io/yarn-find?text=';
const CLIP_MP4 = (uuid: string) => `https://y.yarn.co/${uuid}.mp4?v=0`;
const CLIP_ID_RE = /yarn-clip\/([a-f0-9-]{36})/gi;

const SEARCH_HEADERS: Record<string, string> = {
  'Accept-Language': 'en-US,en;q=0.9',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
};
const DOWNLOAD_HEADERS: Record<string, string> = {
  Referer: 'https://getyarn.io/',
  Accept: 'video/webm,video/ogg,video/*;q=0.9,application/ogg;q=0.7,audio/*;q=0.6,*/*;q=0.5',
  'Accept-Language': 'en-US,en;q=0.9',
};

export interface YarnClip {
  /** Stable yarn clip UUID — the key for the playable MP4. */
  uuid: string;
  /** The playable MP4 URL on the yarn CDN. */
  mp4Url: string;
}

/** A Chrome-impersonating HTTP client. Pass a residential proxy URL (e.g. Apify
 *  Proxy) to bypass datacenter-IP reputation blocks; omit to go direct. */
function client(proxyUrl?: string): Impit {
  return new Impit({ browser: 'chrome', ...(proxyUrl ? { proxyUrl } : {}) });
}

/** Parse distinct yarn clip UUIDs from a yarn-find HTML page, in document order. */
export function parseClipIds(html: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const m of html.matchAll(CLIP_ID_RE)) {
    const id = m[1].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export interface YarnSearchResult {
  ok: boolean;
  status: number;
  bytes: number;
  clips: YarnClip[];
  /** First ~200 chars of the body when the parse found nothing — lets the caller
   *  tell a Cloudflare challenge page apart from a genuine no-results page. */
  snippet?: string;
}

/** Search getyarn.io for a phrase. Returns the clip list plus raw diagnostics
 *  (status/bytes/snippet) so callers — and the spike — can see exactly what came
 *  back. Never throws on a non-200; reports it. */
export async function searchYarn(
  phrase: string,
  opts: { proxyUrl?: string; limit?: number } = {},
): Promise<YarnSearchResult> {
  const url = SEARCH_BASE + encodeURIComponent(phrase.trim());
  const res = await client(opts.proxyUrl).fetch(url, { headers: SEARCH_HEADERS });
  const status = res.status;
  const html = await res.text();
  const ids = parseClipIds(html);
  const limited = typeof opts.limit === 'number' ? ids.slice(0, opts.limit) : ids;
  return {
    ok: status === 200 && ids.length > 0,
    status,
    bytes: html.length,
    clips: limited.map((uuid) => ({ uuid, mp4Url: CLIP_MP4(uuid) })),
    ...(ids.length === 0 ? { snippet: html.slice(0, 200).replace(/\s+/g, ' ').trim() } : {}),
  };
}

export interface YarnDownload {
  ok: boolean;
  status: number;
  contentType: string | null;
  bytes: number;
  /** True when the payload actually looks like an MP4 (ISO-BMFF 'ftyp' box). */
  isMp4: boolean;
  data?: Uint8Array;
}

/** Download a yarn clip's MP4 by UUID. Returns the bytes + diagnostics; validates
 *  the ISO-BMFF 'ftyp' signature so a challenge HTML page can't masquerade as a
 *  video. Never throws on a bad response. */
export async function downloadYarnClip(
  uuid: string,
  opts: { proxyUrl?: string } = {},
): Promise<YarnDownload> {
  const res = await client(opts.proxyUrl).fetch(CLIP_MP4(uuid), { headers: DOWNLOAD_HEADERS });
  const status = res.status;
  const buf = new Uint8Array(await res.arrayBuffer());
  // ISO base media files have 'ftyp' at bytes 4..8.
  const isMp4 =
    buf.length > 12 &&
    buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70;
  return {
    ok: status === 200 && isMp4,
    status,
    contentType: res.headers.get('content-type'),
    bytes: buf.length,
    isMp4,
    ...(isMp4 ? { data: buf } : {}),
  };
}
