# One-click publish — OAuth scopes setup (operator)

> Internal operator doc (ops/docs — never ship to the public /docs).
> Status as of 2026-06-12: everything Claude could do via API is DONE; the two
> remaining steps need Brayson's Meta dashboard access.

## YouTube — ✅ nothing to do

The Nango `youtube` integration already requests `https://www.googleapis.com/auth/youtube`
(the broad "manage your channel" scope), and Google's `videos.insert` accepts that
scope — uploads work with the EXISTING connections, no scope change, no reconnect.

Notes:
- Vertical videos ≤ 3 min are classified as Shorts automatically by YouTube.
- That scope is "sensitive" in Google's tiers: it already worked for reads, so
  whatever consent-screen state the Google app is in covers uploads too.

## Instagram Reels — 2 steps left (Meta dashboard + reconnect)

Done already (via the Nango API, 2026-06-12):
- The Nango `instagram` integration's scopes were set to
  `instagram_business_basic, instagram_business_manage_comments, instagram_business_content_publish`
  (they were previously empty/null — connect flows relied on app defaults).

Still required:
1. **Meta app dashboard** ([developers.facebook.com](https://developers.facebook.com) →
   your app → **Instagram** product → API setup with Instagram login):
   confirm `instagram_business_content_publish` is available/enabled for the app.
   In Development mode this works for the app's own / tester Instagram accounts;
   publishing for arbitrary client accounts later requires **App Review** for that
   permission (same review track you already know from the analytics scopes).
2. **Reconnect Instagram** on `/connections` for any tenant that should publish —
   existing tokens were granted BEFORE the scope change and don't carry
   `instagram_business_content_publish`. The publish path detects this and returns
   "reconnect Instagram in /connections" instead of a fake success.

Account requirement: the IG account must be a **Professional** (Business/Creator)
account. Personal accounts can't use the content-publishing API at all.

## Analytics panels (bonus, same session)

The Nango dashboard ids didn't match our internal provider keys, so these env
overrides were added to Vercel production (+ `.env.local`):

- `NANGO_TIKTOK_CONFIG_KEY=tiktok-accounts` (TikTok Business / business-api.tiktok.com)
- `NANGO_FACEBOOK_ADS_CONFIG_KEY=meta-marketing-api` (ads_read insights)

The `/connections` page only offers tiles whose integration id exists in Nango, so
TikTok + Facebook Ads tiles appear once a deploy picks these up. Connect an account
and the `/analytics` panels populate on the next 5-minute poll.

## Still missing entirely (future)

- **X** and **LinkedIn** have publishers in code (`src/lib/x.ts`, `linkedin.ts`) but
  NO integrations in Nango yet — create the OAuth apps per `ops/docs/publishing-connectors.md`.
