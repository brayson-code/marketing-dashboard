# Social OAuth via Nango — dev-app setup (Track C)

Nango handles the OAuth flow, token storage, refresh, and a unified proxy. But each
platform still requires **you** to register a developer app and hand Nango its
client id/secret. This is that checklist. Do these once per platform.

## 0. Nango (do first)
1. Create a **Nango Cloud** account → https://app.nango.dev
2. Grab the **Secret Key** (Environment Settings). Newer Nango uses the **Connect
   session-token** flow — the backend mints a short-lived token with the Secret Key
   and the frontend uses that token. **There is NO public key anymore.**
   - Only one env var is needed: `NANGO_SECRET_KEY` (server-side). ✅ Already set in Vercel.
3. The OAuth **redirect/callback URL** to register in every provider below is Nango's:
   ```
   https://api.nango.dev/oauth/callback
   ```
4. For each platform: Nango dashboard → **Integrations → New** → pick the provider template →
   paste the app's Client ID + Secret + scopes → note the **integration id** (provider config key).

---

## 1. Meta — Instagram + Facebook (one app covers both) — HEAVIEST
- Where: https://developers.facebook.com → **My Apps → Create App → Business**
- Add products: **Facebook Login**, **Instagram Graph API**, **Pages API**
- Prereq: the IG account must be a **Business/Creator** account linked to a **Facebook Page**
- Scopes: `instagram_basic`, `instagram_content_publish` (post), `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts` (FB posting), `read_insights` (analytics), `business_management`
- Add the Nango callback under **Facebook Login → Settings → Valid OAuth Redirect URIs**
- Give Nango: **App ID + App Secret**
- ⚠️ Publishing + insights scopes need **App Review + Business Verification** (days). Works with
  added "app testers" before review.

## 2. LinkedIn
- Where: https://www.linkedin.com/developers → **Create app** (needs an associated LinkedIn **Company Page**)
- Products: **Sign In with LinkedIn (OpenID Connect)** + **Share on LinkedIn** (posting); **Marketing Developer Platform** for org analytics (apply — approval needed)
- Scopes: `openid profile email` (identity), `w_member_social` (post as member); org/analytics via Marketing API
- Add the Nango callback under **Auth → Authorized redirect URLs**
- Give Nango: **Client ID + Client Secret**
- ⚠️ `w_member_social` + Marketing API need approval.

## 3. YouTube — via Google Cloud
- Where: https://console.cloud.google.com → **New Project** → **APIs & Services → Library → enable "YouTube Data API v3"** (+ "YouTube Analytics API" for metrics)
- **OAuth consent screen**: External; add scopes; add test users (or submit for verification for prod)
- **Credentials → Create OAuth client ID → Web application** → Authorized redirect URIs: add Nango callback
- Scopes: `.../auth/youtube.upload` (publish), `.../auth/youtube.readonly`, `.../auth/yt-analytics.readonly` (analytics)
- Give Nango: **Client ID + Client Secret**
- ⚠️ Upload/analytics are **sensitive/restricted scopes** → Google verification needed for production; test mode works with added test users.

## 4. X (Twitter)
- Where: https://developer.x.com → developer account. **Posting requires a PAID tier** (Basic ~$200/mo); the free tier won't post.
- Create a **Project + App** → enable **OAuth 2.0** → type **Web App / confidential client**
- Scopes: `tweet.read`, `tweet.write` (post), `users.read`, `offline.access` (refresh)
- Set the Nango callback as the redirect URL
- Give Nango: **OAuth 2.0 Client ID + Client Secret**
- ⚠️ Paid API tier required to publish; analytics are limited.

---

## Suggested order (least → most friction)
1. **Google/YouTube** (test users, fast) 2. **LinkedIn** 3. **Meta IG/FB** (review + business verification) 4. **X** (paid).

## What the dev does after (Track C build)
- `NANGO_SECRET_KEY` is set in Vercel (server-side). No public key needed.
- Frontend: `nango.openConnectUI()` "Connect" buttons + a Connections screen.
- Backend: `new Nango()` → `nango.proxy()` for publish/read; brand-voice pull → knowledge base.
- SDKs already installed: `@nangohq/node`, `@nangohq/frontend`.
