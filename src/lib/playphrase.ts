// Movie-clip search via PlayPhrase (getyarn's bigger, more reachable cousin).
//
// PlayPhrase's clip catalogue is the "official library" of real movie/TV phrase
// clips. Two facts shape this module:
//   1. SEARCH needs a real browser. The search API (/api/v1/phrases/search) is
//      guarded by an SPA anti-forgery check that 403s ("Old page, reload") for
//      raw HTTP — it only answers when the request is fired by the site's own
//      router. So we drive a headless Chromium (puppeteer-core + @sparticuz/
//      chromium on Vercel) to the SPA's #/search route and read back the XHR.
//   2. DOWNLOAD is plain HTTP. Clips live on open Wasabi S3 (no auth, no
//      Cloudflare), so previewing (stream the S3 URL in a <video>) and importing
//      (fetch → Blob) need no browser at all — they're fast.
//
// Because the catalogue is shared/public, every phrase is searched at most once
// across the whole platform: results are cached in movie_clip_cache, so repeat
// phrases (and every other tenant) get an instant hit. The browser cost is paid
// once per unique phrase, then never again.

import type { Browser, Page } from 'puppeteer-core';
import { put } from '@vercel/blob';
import { sql, jsonb } from '@/lib/db/client';
import { createAsset, type AssetRow } from '@/lib/assets';

export interface MovieClip {
  id: string;
  text: string;        // the spoken phrase
  movie: string;       // "Movie Title (Year) [hh:mm:ss]"
  videoUrl: string;    // open S3 mp4 — directly playable + downloadable
  words?: unknown;     // word-level timestamps (for optional splicing later)
  contentSafety?: unknown;
}

const ORIGIN = 'https://www.playphrase.me';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36';
const STEALTH = `
  Object.defineProperty(navigator,'webdriver',{get:()=>false});
  Object.defineProperty(navigator,'plugins',{get:()=>[1,2,3,4,5]});
  Object.defineProperty(navigator,'languages',{get:()=>['en-US','en']});
  window.chrome = { runtime: {} };
`;

const normalize = (p: string) => p.trim().toLowerCase().replace(/\s+/g, ' ');

// ── Browser singleton ────────────────────────────────────────────────────────
// Kept at module scope and reused across invocations (Vercel Fluid Compute keeps
// the instance warm), so only the FIRST search on a cold instance pays the
// ~5-7s Chromium boot. A disconnected/crashed browser is transparently relaunched.
let browserPromise: Promise<Browser> | null = null;
let bootstrappedPage: Page | null = null;

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import('puppeteer-core')).default;
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    return puppeteer.launch({
      args: [...chromium.args, '--disable-blink-features=AutomationControlled'],
      executablePath: await chromium.executablePath(),
      headless: true,
    });
  }
  // Local dev: drive the installed Chrome.
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
  ].filter(Boolean) as string[];
  return puppeteer.launch({
    headless: true,
    executablePath: candidates[0],
    args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  });
}

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b.connected) return b;
    } catch {
      /* fall through to relaunch */
    }
  }
  bootstrappedPage = null;
  browserPromise = launchBrowser();
  return browserPromise;
}

// One bootstrapped SPA page, reused. Returns a page already loaded on the
// PlayPhrase origin with stealth installed, ready to navigate to #/search.
async function getPage(): Promise<Page> {
  if (bootstrappedPage && !bootstrappedPage.isClosed()) return bootstrappedPage;
  const browser = await getBrowser();
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.evaluateOnNewDocument(STEALTH);
  await page.goto(`${ORIGIN}/`, { waitUntil: 'networkidle2', timeout: 30_000 });
  bootstrappedPage = page;
  return page;
}

// Serialize searches — a single browser page can't run two navigations at once.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

function mapClip(ph: Record<string, unknown>): MovieClip | null {
  const videoUrl = (ph['video-url'] as string) || '';
  if (!videoUrl) return null;
  const info = (ph['video-info'] as { info?: string } | undefined)?.info;
  return {
    id: String(ph.id ?? ph.index ?? videoUrl),
    text: ((ph.text as string) || '').trim(),
    movie: (info || (ph.movie as string) || '').trim(),
    videoUrl,
    words: ph.words,
    contentSafety: ph['content-safety'],
  };
}

/** Drive the headless browser to fetch one phrase's clips. ~sub-2s on a warm
 *  page, ~5-7s on a cold instance (browser boot). Throws on browser/nav failure
 *  so the caller can surface a clean error (the cache still serves known phrases). */
async function browserSearch(phrase: string, limit: number): Promise<MovieClip[]> {
  return enqueue(async () => {
    const page = await getPage();
    const enc = encodeURIComponent(phrase);
    const waitResp = page.waitForResponse(
      (r) => r.url().includes('/api/v1/phrases/search?') && r.url().includes(`q=${enc}`) && r.status() === 200,
      { timeout: 15_000 },
    );
    await page.goto(`${ORIGIN}/#/search?q=${enc}`);
    const resp = await waitResp;
    const data = (await resp.json()) as { phrases?: Record<string, unknown>[] };
    const phrases = data.phrases ?? [];
    return phrases.slice(0, limit).map(mapClip).filter((c): c is MovieClip => !!c);
  });
}

// ── Cache ────────────────────────────────────────────────────────────────────
async function cacheGet(key: string): Promise<MovieClip[] | null> {
  const rows = (await sql()`
    SELECT clips FROM movie_clip_cache WHERE phrase = ${key} LIMIT 1
  `) as unknown as { clips: MovieClip[] }[];
  if (!rows.length) return null;
  // Bump usage (best-effort; never blocks the read).
  sql()`UPDATE movie_clip_cache SET hit_count = hit_count + 1 WHERE phrase = ${key}`.catch(() => {});
  return rows[0].clips;
}

async function cacheSet(key: string, clips: MovieClip[]): Promise<void> {
  await sql()`
    INSERT INTO movie_clip_cache (phrase, clips) VALUES (${key}, ${jsonb(clips)})
    ON CONFLICT (phrase) DO UPDATE SET clips = ${jsonb(clips)}, updated_at = now()
  `;
}

/** Search PlayPhrase for a phrase. Cache-first: a known phrase returns instantly;
 *  a new phrase runs the browser once, caches, and returns. `fresh` indicates
 *  whether the browser was actually used (for diagnostics). */
export async function searchMovieClips(
  phrase: string,
  opts: { limit?: number } = {},
): Promise<{ clips: MovieClip[]; cached: boolean }> {
  const key = normalize(phrase);
  const limit = opts.limit ?? 8;
  if (!key) return { clips: [], cached: false };

  const hit = await cacheGet(key);
  if (hit) return { clips: hit.slice(0, limit), cached: true };

  const clips = await browserSearch(key, limit);
  // Only cache non-empty results — a transient browser hiccup shouldn't poison
  // the cache with a fake "no results" for a phrase that does have clips.
  if (clips.length) await cacheSet(key, clips).catch(() => {});
  return { clips, cached: false };
}

/** Import one clip into the tenant's media library: download the open-S3 MP4,
 *  re-host it on Vercel Blob (external S3 URLs may be ephemeral), and record it
 *  in tenant_assets so it's usable as a Hyperframes scene clip. */
export async function importMovieClip(clip: { videoUrl: string; text?: string; movie?: string }): Promise<AssetRow> {
  if (!/^https:\/\/[^/]*\bwasabisys\.com\//i.test(clip.videoUrl) && !/playphrase/i.test(clip.videoUrl)) {
    throw new Error('refusing to import a non-PlayPhrase URL');
  }
  const res = await fetch(clip.videoUrl);
  if (!res.ok) throw new Error(`clip download failed: ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  // ISO-BMFF 'ftyp' sanity check so we never store an error page as a video.
  const isMp4 = bytes.length > 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (!isMp4) throw new Error('downloaded file is not an MP4');

  const label = (clip.text || clip.movie || 'movie clip').replace(/[^\w\s'-]/g, '').trim().slice(0, 60) || 'movie-clip';
  const safe = label.replace(/\s+/g, '-').toLowerCase();
  const blob = await put(`movie-clips/${safe}-${bytes.length}.mp4`, Buffer.from(bytes), {
    access: 'public',
    contentType: 'video/mp4',
    addRandomSuffix: true,
  });
  return createAsset({
    kind: 'video',
    name: label,
    url: blob.url,
    pathname: blob.pathname,
    sizeBytes: bytes.length,
    source: 'movie-clip',
  });
}
