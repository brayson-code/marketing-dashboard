# Meta App Review — Submission Package (KeyCommand)

Everything needed to submit the Meta app **KeyCommand** for App Review and move the
Instagram permissions from Development to Advanced Access (Live). Copy the per-permission
paragraphs straight into the review form; follow the screencast script when recording;
tick the settings checklist before hitting Submit.

> **Prepared:** 2026-07-10 · **Target:** move `instagram_business_*` scopes to Advanced Access.

---

## ⚠️ TWO OWNER-ONLY ITEMS (do these first — the dev cannot)

These are the only blockers the developer/agent cannot complete. Everything else in this
package is ready.

1. **App icon (1024×1024 PNG).** Meta requires a square 1024×1024 app icon with no rounded
   corners and no alpha transparency at the edges. Upload it under **App Settings → Basic →
   App Icon**. Use the KeyCommand / KeyPlayers mark on a solid background.
2. **App category.** Pick the category under **App Settings → Basic → Category**.
   **Recommended: "Business and Pages"** (this is the closest current equivalent to the old
   "Business" category for a tool that manages business Pages/IG accounts). If that exact
   label isn't shown in your dashboard, choose **"Business"**; both map to the same review
   track for a business-account management tool.

Everything below is drafted and ready — you only need to provide the two items above,
record the screencast (script provided), and click Submit.

---

## App facts (for reference while filling the form)

| Field | Value |
|---|---|
| App name | **KeyCommand** |
| App ID | **1513658300302452** |
| Instagram App ID | **1648130776934077** |
| Developer contact | **developer@keyplayershq.com** |
| Product | Instagram — **"API with Instagram Login"** (+ Facebook Login for Business basics) |
| OAuth redirect URI | `https://api.nango.dev/oauth/callback` (Nango-hosted) |
| Privacy Policy URL | `https://command.keyplayershq.com/legal/privacy` |
| Data Deletion URL | `https://command.keyplayershq.com/legal/data-deletion` |
| App domain | `command.keyplayershq.com` |
| Current status | Posts successfully in **Development mode** via Nango (test users only) |

**Permissions being requested (5 + Facebook Login basics):**
`instagram_business_basic`, `instagram_business_content_publish`,
`instagram_business_manage_comments`, `instagram_business_manage_messages`,
`instagram_business_manage_insights`.

---

## What KeyCommand is (the "how do you use this" context Meta wants)

KeyCommand is a done-for-you AI marketing command center. **Each client connects their own
Instagram Business/Creator account** (linked to their own Facebook Page) so the software can:

- **draft** social posts, which a **human on the client's team must approve** in an Approvals
  queue before anything is published (nothing auto-publishes — approval is a hard gate);
- **publish** approved posts/reels to the client's own account;
- **ingest** comments and direct messages into a unified inbox so the team can respond;
- **report** on reach/engagement insights for the client's own content.

The reviewer must understand: we act **only on the connected owner's own account**, every
publish is **human-approved**, and we **never sell** data or use it for ads/model training.

---

## Per-permission justifications (paste-ready)

> Paste each block into the matching permission's "Tell us how you'll use this permission"
> field. Each is written to (a) state the feature, (b) tie it to a visible screen, and
> (c) name the exact step in the screencast the reviewer will see.

### `instagram_business_basic`

> KeyCommand is a marketing command center that manages a business's **own** Instagram
> Business/Creator account. We use `instagram_business_basic` to read the connected account's
> profile (username, account ID) and its media list so we can identify the account after the
> user connects it and display it on the Connections screen and throughout the dashboard.
> Without this permission we cannot confirm which account the user linked or associate their
> content, comments, and insights with the correct account. In the screencast you will see the
> user connect their Instagram account on the Connections page, after which the connected
> account is identified and shown as "connected."

### `instagram_business_content_publish`

> Our core feature is drafting social posts with AI and publishing them **only after a human
> on the customer's team approves the draft**. We use `instagram_business_content_publish` to
> publish approved posts and reels to the customer's own connected Instagram Business/Creator
> account, using the standard two-step Graph API flow (create a media container on
> `/{ig-user-id}/media`, then publish via `/{ig-user-id}/media_publish`). Publishing is always
> gated by an explicit human approval in our Approvals queue — nothing is posted automatically.
> In the screencast you will see a draft post reviewed and Approved, then Published to the
> connected Instagram account, and the resulting post appearing on the account.

### `instagram_business_manage_comments`

> KeyCommand gives businesses a single place to see and respond to engagement on their own
> content. We use `instagram_business_manage_comments` to read comments on the connected
> account's media and to post replies on the customer's behalf when their team chooses to
> reply. This lets the customer keep up with audience engagement without leaving the dashboard.
> In the screencast you will see comments from the connected Instagram account surfaced in our
> Engagement inbox, and a reply posted back to a comment.

### `instagram_business_manage_messages`

> Businesses using KeyCommand manage customer conversations from a unified inbox. We use
> `instagram_business_manage_messages` to receive Instagram direct messages sent to the
> connected account and to send replies on the customer's behalf, within Meta's standard
> messaging window. Messages are shown in our Engagement inbox where the customer's team reads
> and responds to them. We honor message-deletion webhooks (a deleted message is removed from
> our stored copy), and users can opt out at any time by disconnecting the account (which
> revokes our access). In the screencast you will see an incoming Instagram DM appear in our
> inbox and a reply sent back from within KeyCommand.

### `instagram_business_manage_insights`

> KeyCommand reports on how a business's own content performs. We use
> `instagram_business_manage_insights` to read reach, impressions, and engagement metrics for
> the connected account's media and account, and present them as performance reports in the
> Analytics/Engagement area of the dashboard. This is read-only reporting on the customer's own
> account. In the screencast you will see insights for the connected account's content
> displayed in our Analytics view after a post is published.

---

## Screencast script (record ONE video, ~3–5 min, showing every permission)

**2026 rules that matter:** static screenshots are NOT accepted — record a screencast showing
the complete user journey; annotate/caption each permission the moment it's used; the reviewer
must be able to reproduce every step with the test credentials you provide. Record the whole
flow with a screen recorder that captures the mouse, popups, and the OAuth window. Add captions
(on-screen text) or narration calling out each permission by name at the step where it's used.

**Before recording:**
- Add the reviewer as a **test user / app tester** in the Meta dashboard (Roles → Roles), OR
  provide **Meta Dashboard** test credentials (non-super-admin recommended). Do NOT share raw
  Instagram account credentials — Meta reviews via test roles.
- Have a KeyCommand login for a workspace whose Instagram Business account is connectable.
- Make sure there is at least one AI-generated draft post ready in Approvals (or generate one
  live on camera), and that the test IG account has a comment and a DM to demonstrate.

**Steps (say/caption the permission name in brackets at each marked step):**

1. **Log in.** Go to `https://command.keyplayershq.com`, sign in, land on the dashboard.
   Caption: "This is KeyCommand — an AI marketing command center for a business's own accounts."
2. **Open Connections.** Click **Connections** in the left navigation (`/connections`). Show the
   "Social connections" section with an **Instagram** tile.
3. **Connect Instagram.** Click **Connect** on the Instagram tile. The Nango Connect UI opens →
   proceed through Meta's OAuth screen → grant the permissions → the window closes and the
   Instagram tile flips to a green **"connected"** badge.
   Caption: **[instagram_business_basic]** — "We read the account profile to identify and display
   the connected account here."
4. **Show a draft & approve it.** Open **Approvals** in the left navigation (`/drafts`). Click a
   pending Instagram post draft to expand it, read the AI-generated content, and click **Approve**.
   Caption: "Every post is human-approved before it can be published — nothing auto-posts."
5. **Publish.** On the approved draft, click **Publish**. Show the success state.
   Caption: **[instagram_business_content_publish]** — "We publish the approved post to the
   connected Instagram Business account." Then switch to the Instagram account (or the account's
   media list in the app) to show the post is live.
6. **Comments.** Go to **Engagement** (`/engagement`). Show a comment from the connected account's
   media in the inbox, and post a reply to it.
   Caption: **[instagram_business_manage_comments]** — "We read comments on the account's media and
   reply on the customer's behalf."
7. **Messages (DMs).** In **Engagement**, show an incoming Instagram DM in the inbox and send a
   reply from within KeyCommand.
   Caption: **[instagram_business_manage_messages]** — "We receive and respond to the account's
   DMs from a unified inbox; users can opt out by disconnecting."
8. **Insights.** Open **Analytics** (or the insights view in Engagement). Show reach/impressions/
   engagement for the connected account's content.
   Caption: **[instagram_business_manage_insights]** — "We report on how the account's own content
   performs."
9. **Show the opt-out / deletion.** Return to **Connections**, click **Disconnect** on the
   Instagram tile, and show the account revert to "not connected."
   Caption: "Disconnecting revokes our token and deletes the cached data — see our Data Deletion
   page." (Optionally show `/legal/data-deletion`.)

**End the video** on the Privacy Policy or Data Deletion page to reinforce data handling.

---

## Settings checklist (verify ALL before Submit)

- [ ] **App Icon** uploaded — 1024×1024 PNG, square, no transparency. *(owner)*
- [ ] **Category** set — "Business and Pages" (or "Business"). *(owner)*
- [ ] **Privacy Policy URL** = `https://command.keyplayershq.com/legal/privacy` (App Settings →
      Basic). ✅ Page is live, public, indexable.
- [ ] **Data Deletion** = `https://command.keyplayershq.com/legal/data-deletion` set as the
      **Data Deletion Request URL / instructions URL** (App Settings → Basic → User data deletion,
      choose "Data Deletion Instructions URL"). ✅ Page is live and describes the real flow.
- [ ] **App domain** includes `command.keyplayershq.com`.
- [ ] **OAuth redirect URI** `https://api.nango.dev/oauth/callback` is listed under Facebook Login
      for Business → Settings → Valid OAuth Redirect URIs, and under the Instagram product config.
- [ ] **Business Verification** completed for the Meta Business Portfolio (required for Advanced
      Access to these scopes) — *may already be done; confirm in Business Settings → Security Center.*
- [ ] All **5 permissions** added to the submission, each with its justification (above) and each
      demonstrated in the screencast.
- [ ] **Test credentials / test user** provided so the reviewer can reproduce the flow (Meta
      Dashboard access or app-tester role — NOT raw IG credentials).
- [ ] Screencast uploaded, with each permission captioned at its step.

---

## Data-handling answers Meta asks about (paste-ready)

- **Do you sell or transfer data?** No. We never sell personal information and do not share it for
  advertising. Data is disclosed only to sub-processors that operate the Service (Anthropic,
  Supabase, Vercel, Nango, Stripe) under contract.
- **Do you use the data to train AI models?** No. Meta data is used only to provide the features
  the user enabled; it is not used to train our or any generalized AI models.
- **Where is data stored / how secured?** Encrypted in transit (TLS) and at rest; OAuth tokens are
  held by Nango and never displayed in full; tenant isolation is enforced at the database layer
  (Row-Level Security); publishing and messaging are human-in-the-loop.
- **How can users delete their data?** Self-serve in-app: Connections → Disconnect revokes the
  OAuth token (deleted upstream at Nango) and deletes the cached content; or by emailing
  `developer@keyplayershq.com`. Documented at `/legal/data-deletion`.

---

## Notes / gotchas

- **Only submit what's built and shown.** Meta rejects permissions with no demonstrated feature.
  All five here map to a real, visible screen — keep it that way; don't add scopes you can't show.
- **Timeline:** budget **2–4 weeks** per review round; incomplete screencasts are the #1 rejection
  reason. If rejected, the message names the failing permission — re-record just that step.
- **During review** the app stays in Development mode; only test users/app testers can connect.
  Real client onboarding for these scopes begins once Advanced Access is granted.
- **Facebook Login for Business basics** (public_profile / the login itself) is granted by default
  and doesn't need separate review; it's the Instagram scopes that do.

---

### Sources (2026 Meta App Review guidance)

- [App Review — Instagram Platform (Meta for Developers)](https://developers.facebook.com/docs/instagram-platform/app-review/)
- [Instagram App Review — Chatwoot Developer Docs](https://developers.chatwoot.com/self-hosted/instagram-app-review)
- [Why Meta App Review Keeps Disapproving Your App — Postmoore](https://www.postmoo.re/blogs/meta-app-review-disapproved-how-to-get-approved)
- [Post to Instagram via API: Guide (2026) — Postproxy](https://postproxy.dev/blog/post-to-instagram-via-api/)
