# Hyperframes Agent Hub — Build Plan

## DIRECTION LOCKED (2026-06-09)
Goal: **Hormozi-style high-performing reels** — word-by-word captions, fast cuts /
punch-in transitions, spliced b-roll/a-roll, small bold infographics. **No stock
imagery, no corporate junk.** Easy for content-driven (non-editor) users.

Decisions:
- **Editor model: agent-first now → timeline later.** The agent auto-builds the
  full reel; the user refines in a simple UI. A multi-track timeline (CapCut-grade)
  is layered on later for power users, on the SAME Hyperframes format. ("Premiere-
  grade" and "easy" conflict — easy wins via agent-first.)
- **Assets: user library + AI-generated, never stock.** Per-tenant uploaded
  footage (a-roll/b-roll) + AI-generated clips (HeyGen) when needed. Build a
  per-tenant asset manager.
- **NO embed of HeyGen Studio.** Confirmed `app.heygen.com` sends CSP
  `frame-ancestors 'self' …` → iframe is blocked. Remote-browser streaming is
  costly/fragile/non-programmatic — rejected. We own the editor; HeyGen is the
  render engine only.
- **Captions** come from **Deepgram** (already a connection) → word-level
  timestamps → karaoke captions. **Render** = our composition → Hyperframes HTML
  (validated) → HeyGen cloud (validated, credited key wired).

Build order: **(1) render loop** [✅ SHIPPED 2026-06-09 — editor Render button →
`/api/hyperframes/[id]/render` → composition→HTML→zip→base64 `POST /v3/hyperframes/
renders` (`src/lib/heygen-render.ts`) → poll → inline MP4 preview. base64 project
shape confirmed: `{type:'base64',media_type:'application/zip',data}`. Verified
end-to-end on a credited key.] → (2) rich format
(caption track, transitions, b-roll/a-roll overlays, infographic components) +
agent upgrade → (3) per-tenant asset manager (upload + AI-gen) → (4) timeline
editor for power users → (5) one-click publish (Phase 3).



> Status: **PLAN ONLY** (nothing built yet). Owner decision on 2026-06-08:
> write the plan first; chosen render engine = **HeyGen API**.

## 1. Vision

A **Hyperframes** tab inside the Content hub where the user (and the agents) go
from idea → finished short-form video → published, without leaving the app:

1. An agent drafts a video script + storyboard (already exists).
2. The user reviews/edits it in an in-app editor.
3. One click renders a real video.
4. One click hands it to an agent that uploads it to the connected channel.

This sits as a 7th… er, 8th tab in the Content hub (`content-tabs.tsx`), next to
Ideas / Scripts / Competitors / Pipeline / Library / Engagement.

## 2. Where we are today (the honest baseline)

| Piece | State |
| --- | --- |
| `hyperframes-agent` | **Exists.** Outputs a structured markdown **script + storyboard only** (platform, hook, scene table, CTA, production notes). No rendering. See `agents/sub-agents/hyperframes-agent/agent.md`. |
| Agent spawn plumbing | **Exists.** `spawnSubAgent('hyperframes-agent', brief)` → `agent_tasks` → `createDraft(...)`. Already invoked from the reel-intel + reel-idea flows. |
| In-app video editor | **Does not exist.** |
| Video rendering | **Does not exist.** No Remotion, no ffmpeg, no HeyGen wired. |
| Video upload to YouTube/Instagram | **Does not exist.** Only text comment-replies are wired (`replyToComment`). No `videos.insert`, no IG content publishing, and the OAuth scopes for upload are not requested. |

So this is a **feature build across 3 phases**, not a wiring task.

## 3. The HeyGen API reality (important nuance)

"HeyGen API" is actually **two different products**, and the name "Hyperframes"
specifically refers to the second one:

### Path A — Avatar Video API (`POST /v2/video/generate`)
- Talking-head / TTS video. Scene-based: `video_inputs[]` = one entry per scene
  (avatar + voice + background). Async: returns `video_id`, poll
  `GET /v1/video_status.get`, get a CDN MP4.
- Pricing: pay-as-you-go, ~**$0.05/sec** (photo avatar 1080p) → ~$3 for a 60s video.
- Good for: explainer / spokesperson reels.

### Path B — Hyperframes (`POST /v3/hyperframes/renders`) ← the actual "Hyperframes"
- **HTML/CSS/JS composition → MP4.** You author a composition (like Remotion /
  Motion Canvas), package it, and render either **locally** (`npx hyperframes
  render`, headless Chromium + ffmpeg, **no API cost**) or in **HeyGen's cloud**
  (upload zip → `render_id` → poll `GET /v3/hyperframes/renders/{id}`).
- Inject dynamic data at render time via a `variables` object.
- Open-source (Apache-2.0): `@hyperframes/core`, `@hyperframes/producer`.
- Good for: motion-graphics reels, text-on-screen, data/animation — full creative
  control, and **renders free locally during development**.

**Recommendation:** lead with **Path B (Hyperframes)** — it matches the product
name, gives a true in-app/owned editor story, and renders for free locally while
we build. Offer **Path A (avatar)** as a per-scene option later for talking-head
content. Both are async + support `callback_url` webhooks (`hyperframes_video.*`
and `avatar_video.*` events).

### Confirmed from the official Hyperframes docs (2026-06-09)
*Sources Brayson shared: hyperframes.heygen.com/packages/cli + hyperframes.dev/design.*

- **CLI:** `npm i -g hyperframes` (or `npx hyperframes`). `hyperframes render -o out.mp4`
  renders an HTML composition **locally, no auth/cost** (needs Node 18+, Chrome,
  FFmpeg/FFprobe). `hyperframes cloud render` renders in HeyGen's cloud (auth).
  `hyperframes init`, `hyperframes preview` (live browser edit), `hyperframes doctor`,
  `hyperframes lambda` (distributed AWS render).
- **Env vars:** `HEYGEN_API_KEY` (cloud render + account; alias `HYPERFRAMES_API_KEY`),
  `HEYGEN_API_URL` (default `https://api.heygen.com`), `HEYGEN_CONFIG_DIR` (`~/.heygen`),
  `HYPERFRAMES_CUDA`, `PRODUCER_*` perf knobs. → **the key to add is `HEYGEN_API_KEY`.**
- **Dynamic data:** `--variables '{...}'` / `--variables-file` injects values into a
  composition at render time — this is how our editor's composition feeds a template.
- **Authoring format (hyperframes.dev/design):** markdown-first — a `design.md`
  (brand/visual identity) + a `frame.md` (directs the composition: **pacing, scale,
  dwell, motion**) which import into an HTML Hyperframes project. This maps almost
  1:1 onto what our `hyperframes-agent` already emits and what the Phase 2a editor
  now structures.

### Rendering-location decision (the Phase 2b fork)
Vercel functions can't run headless Chrome + FFmpeg in a normal request, so local
CLI render can't happen in-process. Three viable homes for the render:
1. **HeyGen cloud render API** — submit composition + `HEYGEN_API_KEY`, poll/webhook,
   store MP4 in Blob. Simplest to wire; per-render cost (confirm pricing).
2. **`hyperframes lambda`** — distributed AWS render the CLI already supports; owned,
   pay AWS. More setup.
3. **Dedicated render worker** (a small box / container running the CLI locally for
   free) that our app calls. Cheapest per-render, an extra service to run.

**Decision (2026-06-09): HeyGen cloud render API.**

### Phase 2b — confirmed cloud-render contract (HeyGen)
*Source: developers.heygen.com/hyperframes.*
- **Create:** `POST /v3/hyperframes/renders`, header `x-api-key`. Body:
  `project: { type: 'asset_id'|'url'|'base64', ... }` (the composition as a **.zip
  with index.html at root**), `aspect_ratio: '9:16'`, `resolution: '1080p'|'4k'`,
  `fps`, `quality`, `format: 'mp4'`, `variables` (overrides `data-composition-variables`),
  `title`, `callback_url`, `callback_id`. → `202 { data: { render_id, status:'queued' } }`.
- **Poll:** `GET /v3/hyperframes/renders/{render_id}` → status `queued|rendering|
  completed|failed`; completed carries `video_url`, `thumbnail_url`, `duration`.
- **Webhook:** `callback_url` → events `hyperframes_video.success|fail`, `callback_id` echoed.
- Composition zip uploaded via the Assets API (→ `asset_id`), or supplied inline
  via `type:'url'|'base64'`.

### Phase 2b build pipeline
1. `composition → Hyperframes HTML project` generator (index.html using
   `@hyperframes/core` runtime for scene timing/animation + `data-composition-variables`).
2. zip it → upload (Assets API → `asset_id`) **or** inline `base64`.
3. `POST /api/hyperframes/[id]/render` → submit render, store `{ render_id, status }`
   on `draft.metadata.render`.
4. `/api/hyperframes/webhook` (verify secret) → on success download `video_url` →
   Vercel Blob → update `metadata.render`.
5. Editor "Render" button → states (queued→rendering→done) + inline MP4 preview.

### Blockers before building Phase 2b
- **`HEYGEN_API_KEY`** in `.env.local` (dev) + Vercel env (prod). Can't build/verify
  the network calls without it.
- **Validate the Hyperframes HTML authoring conventions** (`@hyperframes/core` timeline
  API) with a one-scene **spike render** before building the full HTML generator —
  the exact runtime API for scene timing/animation isn't fully documented, so we
  confirm the format with a real render rather than guess.

> Open question to confirm with HeyGen before Phase 2: exact **cloud Hyperframes
> render pricing** (not on the public pricing page) and the **per-minute rate cap**
> (only the "10 concurrent renders" limit is documented). No official REST SDK;
> community `@teamduality/heygen-typescript-sdk` exists, or just `fetch`.

## 4. Phased plan

### Phase 1 — Hub + storyboard workspace (no rendering)
*Goal: make the agent's output a first-class, editable thing in the UI.*

- New route `src/app/content/hyperframes/page.tsx`; add a **Hyperframes** tab to
  `content-tabs.tsx` (and fold it into the nav `matchPrefixes`).
- **List** existing hyperframes-agent outputs: reuse `listReelScripts()` /
  `agent_drafts` where `created_by = 'hyperframes-agent'`.
- **Generate**: a brief box → `POST /api/hyperframes/generate` → existing
  `spawnSubAgent('hyperframes-agent', brief)` → `createDraft`. (Reuses all
  current plumbing; no new agent.)
- **Storyboard editor**: parse the agent's markdown scene table into editable
  **scene cards** (time, visual, on-screen text, audio). Save edits back to the
  draft `payload`. This is the "editor" without yet rendering pixels.
- **Hand-off**: "Open in HeyGen" deep-link + copy-the-brief button (bridges to
  HeyGen's web UI for users who want it now).
- *No new deps. Ships fast. Fully reversible.*

### Phase 2 — Real in-app rendering (HeyGen)
*Goal: the "make videos" part for real.*

- Env: `HEYGEN_API_KEY` (+ store via the existing integrations/secret pattern).
- New table `video_renders`: `{ id, tenant_id, draft_id, provider, provider_job_id,
  status (queued|rendering|completed|failed), video_url, thumbnail_url, duration,
  cost_cents, error, created_at, completed_at }`.
- `POST /api/hyperframes/render` — map the edited storyboard → a Hyperframes HTML
  composition (templated) OR an avatar `video_inputs[]` payload; submit; store the
  job row. Start with **local render** in dev (free) to validate the template
  pipeline, then flip to cloud.
- Webhook: `POST /api/hyperframes/webhook` (subscribe `hyperframes_video.success/
  fail`, verify the signing secret) → update `video_renders`, store the MP4 in
  **Vercel Blob**, generate a thumbnail.
- UI: render button + progress (queued→rendering→done), inline MP4 preview,
  re-render. Respect the **10-concurrent** cap (queue beyond it; surface it — no
  silent drops).
- A small **composition template library** (1–3 reel templates) is the real work
  here.

### Phase 3 — One-click publish
*Goal: agents upload finished videos with a click.*

- **YouTube**: add the `youtube.upload` scope (new Nango/OAuth config), implement
  resumable `videos.insert` in `src/lib/youtube.ts` (`uploadVideo(fileUrl, meta)`).
  Note: each upload costs ~1600 YouTube quota units — budget for it.
- **Instagram**: Graph API content-publishing (`/media` → `/media_publish`) for
  Reels; needs the publishing scopes. (TikTok later.)
- Extend `publishContent()` in `src/lib/drafts.ts` to route `platform:
  'youtube_video' | 'instagram_reel'` to the new uploaders (today it only handles
  comment replies + simulates the rest).
- **Agent one-click**: the flow becomes — agent renders → creates a draft with the
  Blob video URL → owner taps **Approve** → `publishContent()` uploads. The
  "agent uploads with one click" = the approve action triggering the upload. (Or a
  fully-autonomous path gated behind the existing Autonomy settings.)

## 5. Risks / open questions
- **HeyGen cloud render pricing + rate caps** — confirm before Phase 2 budgeting.
- **YouTube upload quota** (~1600 units/upload) can exhaust the daily 10k quota
  fast — may need quota increase or scheduling.
- **OAuth scope expansion** (Phase 3) means re-consent for connected accounts.
- **Storage**: rendered MP4s need Vercel Blob (private) + lifecycle/cleanup.
- **Cost controls**: per-tenant render budget + the existing rate-limit pattern.

## 6. Sequencing & rough effort
1. **Phase 1** — hub + storyboard editor: small, no new infra. *Best next step.*
2. **Phase 2** — rendering: medium; the template pipeline + job/webhook/Blob.
3. **Phase 3** — publish: medium-large; gated mostly by OAuth scope + platform
   upload quirks, not by our own code.

Recommendation: build **Phase 1** first to make the agent output tangible and get
the tab live, validate the storyboard-editor UX, then commit to Phase 2 once
HeyGen pricing/limits are confirmed.
