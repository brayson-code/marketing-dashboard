# Publishing connectors — what's real vs. simulated

When an approved draft is executed (manually from Approvals, or auto-executed by
the autonomy gate), `publishContent` / `sendEmail` / `confirmMeeting` in
`src/lib/drafts.ts` route by `metadata.platform`. This page is the honest map of
which routes hit a real external API and which still simulate.

A failed real publish **never** fakes success: the draft stays `approved` with a
tagged error (`x publish failed: …`), so it can be retried after the connection
or scope is fixed. A simulated execution flips the status but stamps the note
`(simulated — no external API wired yet)` so the audit trail never lies.

---

## Publishes for real (once connected in /connections)

| `metadata.platform` | What happens | Connector |
|---------------------|--------------|-----------|
| `youtube_comment` | Replies to the tagged top-level comment (`metadata.youtube.parent_comment_id`) | `src/lib/youtube.ts` → `replyToComment` |
| `instagram_comment` | Replies to the tagged IG comment (`metadata.instagram.parent_comment_id`) | `src/lib/instagram.ts` → `replyToComment` |
| `x` | Posts the draft payload as a tweet. Copy over 280 characters becomes a thread (split on paragraph → sentence → word boundaries; each chunk replies to the previous tweet). The audit note records the **first** tweet's id. | `src/lib/x.ts` → `postTweet` |
| `linkedin` | Posts to the connected **member's** feed via the versioned Posts API (`/rest/posts`, `LinkedIn-Version: 202506`). The audit note records the post URN (from the `x-restli-id` response header). Organization-page posting is not wired (needs Marketing Developer Platform approval). | `src/lib/linkedin.ts` → `createPost` |
| `facebook` | Posts to the **first Facebook Page** the connected user manages, using that Page's own access token from `/me/accounts`. Accounts that manage no Pages get a tagged `facebook: no managed pages` error — personal profiles can't be posted to via the API at all. | `src/lib/facebook.ts` → `createPagePost` |

All five run through the Nango proxy (`connection_id == tenant_id`), so each
client posts through **their own** connected account — never a shared app token.

## Still simulated (status flips, nothing goes out)

| Route | Why |
|-------|-----|
| `publishContent` for any other platform (TikTok, untagged drafts, …) | No connector yet. Note says `(simulated — no external API wired yet)`. |
| `sendEmail` for non-AgentMail drafts | AgentMail is the real send path. There is no per-tenant Gmail/SMTP send credential today (`/api/integrations/gmail` is a legacy env-var IMAP **reader**) — a credential model has to exist before this can be real. |
| `confirmMeeting` | Google Calendar needs a Google OAuth connection (calendar scope) that doesn't exist in the provider set yet. |

---

## Prerequisite per platform: the Nango dashboard

The Connections page only offers a provider tile once its OAuth app is wired in
the **Nango dashboard** (Integrations → New → paste client id/secret — full
walkthrough in [nango-oauth-setup.md](./nango-oauth-setup.md)). Per platform:

- **X** — developer app on a **paid** API tier (the free tier can't post).
  Scopes: `tweet.read`, `tweet.write`, `users.read`, `offline.access`.
- **LinkedIn** — app with **Sign In with LinkedIn (OpenID Connect)** (we resolve
  the member URN via `/v2/userinfo`) **and** **Share on LinkedIn**
  (`w_member_social`). Scopes: `openid profile w_member_social`.
- **Facebook** — Meta Business app with `pages_show_list`,
  `pages_read_engagement`, `pages_manage_posts`. Publishing scopes need App
  Review + Business Verification; app testers work before review. The connected
  user must **admin a Facebook Page**.
- **YouTube** — Google Cloud app with the YouTube Data API scopes (already live
  for comment replies).
- **Instagram** — covered by the same Meta app; the IG account must be
  Business/Creator and linked to a Facebook Page (already live for comment
  replies).

Once the integration exists in Nango, each client connects their own account at
**/connections** — no code change needed per tenant.
