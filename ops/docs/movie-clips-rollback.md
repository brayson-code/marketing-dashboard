# Movie Clips (PlayPhrase) — rollback runbook

The Hyperframes "Movie clips" finder: search a quote → preview real movie/TV clips
(streamed from PlayPhrase's open S3) → "Add to library" downloads the clip to
Vercel Blob + `tenant_assets`. Search is driven by a headless Chromium
(`puppeteer-core` + `@sparticuz/chromium`) hitting PlayPhrase's SPA; results are
cached globally in `movie_clip_cache` so each phrase is browser-searched at most
once platform-wide.

## Kill switch (instant, no code change)

The whole feature is gated on the env flag **`MOVIE_CLIPS_ENABLED`** (production).

- **Disable:** set `MOVIE_CLIPS_ENABLED=false` (or remove it) → redeploy.
  - The panel disappears (`/api/auth/me` returns `movie_clips_enabled:false`, the
    `<ClipFinder/>` renders `null`).
  - `/api/clips/search` and `/api/clips/import` return `503 {error:'disabled'}`.
  - Nothing else is touched — the feature is fully additive.
- **Re-enable:** set it back to `true` → redeploy.

```
vercel env rm MOVIE_CLIPS_ENABLED production   # or: set to false
vercel deploy --prod --yes
```

## Failure modes & what they mean

- **502 `... /@sparticuz/chromium/bin does not exist`** — the Chromium pack didn't
  get traced into the function. It's pinned via `outputFileTracingIncludes` in
  `next.config.ts` under the `/api/clips/**/*` key. If a `@sparticuz/chromium`
  version bump moves the path, update that glob.
- **502 `Browser closed unexpectedly` / launch timeout** — Chromium couldn't boot
  (memory/cold-start). Search route `maxDuration=60`. Cache still serves known
  phrases. Flip the kill switch if persistent.
- **Search returns clips but slow (~8s)** — expected on a COLD instance for an
  UNCACHED phrase (one-time Chromium boot). Cached = ~0.3s; warm instance, new
  phrase = ~0.9s. Postgres `movie_clip_cache` makes every phrase fast after first.

## Full revert (code)

Feature is additive. New: `src/lib/playphrase.ts`, `src/app/api/clips/{search,import}/route.ts`,
`src/components/hyperframes/clip-finder.tsx`, migration `0046_movie_clip_cache.sql`,
deps `puppeteer-core` + `@sparticuz/chromium`. Edits: `assets.ts` (source type +`movie-clip`),
`auth/me` (flag), `hyperframes/page.tsx` (mount `<ClipFinder/>`), `next.config.ts` (externals + tracing).

```
git revert <commit-range>      # revert the movie-clips commits
```

The `movie_clip_cache` table is harmless to leave (global, no tenant data). To
drop: `drop table public.movie_clip_cache;`. Imported clips already in
`tenant_assets` are normal video assets and unaffected by a revert.

## Notes

- 100% free / self-hosted: no Apify, no paid scraping API, no stock libraries.
- PlayPhrase clips are on open S3 (no auth) — preview & download need no browser;
  only SEARCH does. Yarn was rejected (Cloudflare interactive-Turnstile wall).
- Legal posture is Brayson's call (short movie clips, entertainment cutaways).
