# AI Video Editor Roadmap — "Palmier for multi-tenant marketing agencies"

> Status: **PLAN ONLY** (2026-06-19). Reverse-engineers Palmier Pro and maps a
> native replica onto the Command Center stack. No code changed to write this.
> Sibling plan: `plans/hyperframes-hub.md` (the render-loop plan this builds on).

---

## 1. Vision

An **AI-native, agent-drivable timeline editor** living inside the Command Center
Content hub — where, for any client tenant, generation and editing happen in the
same surface and an agent can drive the whole thing.

The loop we want, per client, with zero tool-switching:

> agent writes brief → script/storyboard → **generates media on the timeline**
> (Veo / Kling / Nano Banana) → **edits the cut** (trim/reorder/captions/b-roll) →
> renders MP4 → schedules/publishes to the connected channel.

**Why this beats Palmier (the differentiation):** Palmier is a brilliant *standalone*
macOS NLE. It cannot author a brief, doesn't know the client's brand voice, has no
CRM/scheduling/publishing, and isn't multi-tenant. We already own all of that
(`hyperframes-agent`, company brief injection, per-tenant assets, OAuth publishing
in `plans/hyperframes-hub.md` Phase 3). Palmier's moat is the *editor + in-timeline
generation + MCP*. Our moat is wrapping that editor in an **orchestrated, per-client
marketing pipeline**. We don't need to out-edit Premiere; we need to be the only
place where "an agent makes and ships a client's video" is one continuous flow.

---

## 2. Reverse-engineering findings (confirmed vs inferred)

Sources at the bottom. **Confirmed** = stated in Palmier's site/docs/README/YC
launch or the DeepWiki of their open repo. **Inferred** = my best read.

### 2a. What Palmier is (confirmed)
- **Palmier Pro** — YC **S24** (founders Marcos Rico Peng & Harrison). Launched
  publicly mid-June 2026. Tagline "the video editor built for AI."
- **Native Swift / AVFoundation macOS app** (macOS 26 Tahoe, Apple Silicon).
  **Not** Electron/Tauri, **not** ffmpeg — AVFoundation does composition/playback/
  export. Document-based: `NSDocument` + a `.palmier` file-package. **GPLv3**, editor
  open-source; generative-AI features need login + subscription.
  - *(A separate, smaller repo `palmier-io/sixsevenstudio` "Sora 2 Storyboard" DOES
    use Tauri + ffmpeg-sidecar — not the flagship.)*
- **The one big idea:** generation is a **timeline primitive**. Every generated clip
  keeps its **prompt + model + reference images** attached, so you **regenerate in
  place** instead of bouncing to a web tool and re-importing. First/last-frame lock,
  reference images for subject/style consistency, set resolution/duration/aspect.
- **Models:** Kling V3, Seedance 2.0 (ByteDance), Veo 3.1 (Google), Grok Imagine
  (xAI), Nano Banana Pro. Pitched as "not locked to one provider's look."
- **Pricing:** editor + MCP **free**; **credits** for generation. Pro ~$29/mo (launch)
  / $49 list = 5,000 credits (~333 images or 3–7 min video); Max ~$69/$99 = 12,000.
  Chat is free if you **BYO Anthropic key**; otherwise routes through their backend.
- **Export:** MP4 (H.264 / H.265 / ProRes) **and NLE XML for Premiere Pro + DaVinci
  Resolve**. (FCPXML/EDL not explicitly named.)

### 2b. In-timeline AI generation — how it works
- **Confirmed:** "Pick a model," generate video/image/audio directly onto the
  timeline; clip carries prompt+model+refs; async generation pipeline.
- **Inferred (the model backend):** Palmier does **not** disclose whether it calls
  Kling/Veo/ByteDance directly or via an aggregator. The credit system + a single
  `PalmierClient` that "routes requests through the Palmier backend" strongly implies
  **a server-side aggregation layer** (their backend fans out to providers, likely via
  **fal.ai / Replicate** or direct provider APIs, and meters credits). A native Swift
  app calling six provider SDKs directly is implausible; a proxy is the obvious design.
- **Our replica:** we already have exactly this shape. `src/lib/media-providers/`
  is a `MediaProvider` adapter registry (`index.ts` → `getProvider(id)`), each adapter
  implements `submit()`/`poll()` over a normalized `GenInput`/`SubmitResult`/`PollResult`
  (`types.ts`). Today: **Veo** (`veo.ts`, direct Gemini `predictLongRunning`) +
  **Nano Banana** (`nanobanana.ts`, Gemini), keyed by the per-tenant BYO key
  (`getGoogleAiKey()` → `integrations-store`). **To match Palmier's roster we add
  adapters** — and for Kling/Seedance/Grok the cleanest path is **one fal.ai adapter**
  (BYO fal key, model id per node) rather than six bespoke integrations. Vercel AI
  Gateway is the alternative if we want unified billing/observability over BYO-key.

### 2c. The timeline / edit engine
- **Confirmed:** native Swift NLE on AVFoundation; multi-track; `EditorViewModel`
  holds timeline state; a `ToolExecutor` validates and applies mutations.
- **Our replica:** we **already have a multi-track timeline** —
  `src/components/hyperframes/timeline.tsx` renders ruler + scenes + b-roll +
  text/infographics + punch-beat tracks with drag-resize, editing
  `src/lib/timeline-model.ts` ops (`resizeScene`, `moveOverlay`, `resizeOverlay`,
  `moveInfographic`, `movePunchBeat`). The data model is `Composition` in
  `src/lib/hyperframes-composition.ts` (scenes, layers, backgrounds, overlays,
  infographics, captions). And the **node graph** — `src/components/hyperframes/
  canvas/canvas-board.tsx` (React-Flow: prompt → image → video → assemble nodes) —
  is essentially Palmier's "generation graph" view. **We don't build an NLE; we
  extend `Composition` + `timeline.tsx`.** The gap vs Palmier is mostly *polish*
  (frame-accurate scrub, audio track, playhead preview) not *architecture*.

### 2d. Rendering / playback
- **Confirmed:** Palmier renders/plays/exports natively via AVFoundation (no server
  round-trip; it's a desktop app).
- **Our reality (the hard part):** we're web + Vercel, so we have **three proven-or-
  viable render homes**, and we should keep all three:
  1. **Client `ffmpeg.wasm`** — *we already proved this works* in
     `src/components/hyperframes/supercut-panel.tsx` + `clip-finder.tsx`
     (`@ffmpeg/ffmpeg` 0.12, trim via `-ss/-to`, concat demuxer, normalize to
     720×1280/30fps). Zero server compute, zero per-render cost. Great for **fast
     preview + simple stitch** (exactly the supercut path). Ceiling: long/HD/many-layer
     renders are slow in the browser.
  2. **HeyGen Hyperframes cloud** — `src/lib/heygen-render.ts` already does
     `Composition → HTML → zip → base64 → POST /v3/hyperframes/renders`, per-tenant
     keyed (`getHeyGenKey`). Keep as the **high-quality motion-graphics** render path.
  3. **Server/worker render** (Vercel can't run headless-Chrome+ffmpeg in a request)
     — future: a small render worker or `hyperframes lambda` for heavy jobs.
  - **Decision: tiered render.** Browser ffmpeg.wasm for instant preview + cuts-only
    exports; HeyGen for templated motion-graphics reels; a worker later for 4K/long.

### 2e. Export to Premiere / DaVinci
- **Confirmed:** Palmier exports NLE XML for Premiere + DaVinci.
- **Our replica:** **pure generation, no new infra.** Our `Composition` already has
  everything an EDL/XML needs (ordered scenes with `startMs`/`endMs`, background asset
  URLs, overlays with `start`/`duration`). Write `compositionToFcpxml(comp)` /
  `compositionToEdl(comp)` next to `src/lib/hyperframes-html.ts`. FCPXML imports into
  **both** Premiere and DaVinci; EDL is the lowest-common-denominator fallback. This is
  a **high-leverage, low-cost** steal — it makes us the "generate here, finish in your
  NLE" tool for agencies that still cut in Premiere.

### 2f. MCP — how agents drive the editor
- **Confirmed:** Palmier exposes a **local HTTP MCP server** at
  `http://127.0.0.1:19789/mcp`; a `.mcpb` bundle (Node shim) gives one-click install
  into Claude Desktop / Cursor / Claude Code / Codex. Both the in-app chat and external
  MCP clients route through the **same `ToolExecutor`**. Confirmed tool groups:
  - **Inspection:** `get_timeline`, `inspect_media`, `search_media`
  - **Editing:** `add_clips`, `move_clips`, `split_clip`, `set_clip_properties`
  - **Generation:** `generate_video`, `generate_audio`, `upscale_media`
  - **Organization:** `create_folder`, `move_to_folder`, `rename_media`
- **Our replica — and here's the asymmetry that matters:** Palmier is local-first, so
  it *exposes* an MCP server for *external* agents to reach in. **We're server-side and
  already own the agents** (`src/lib/subagent.ts` → `spawnSubAgent('hyperframes-agent',
  …)`). So we have two MCP directions:
  - **Inbound (parity):** expose a Command-Center MCP server (`/api/mcp` or a hosted
    HTTP MCP endpoint) with the same tool surface (`get_composition`, `add_scene`,
    `set_clip`, `generate_media`, `set_captions`, `render`, `export_xml`) so a client's
    own Claude/Cursor can drive *their* tenant's editor. This is the literal "Palmier
    for agencies" feature.
  - **Internal (our advantage):** the `hyperframes-agent` doesn't *need* MCP — it can
    call the same `ToolExecutor` functions in-process. The cleanest design (steal
    Palmier's `ToolExecutor` idea) is **one shared composition-mutation module**
    (`src/lib/composition-ops.ts`) that BOTH (a) the internal agent tool-loop and
    (b) the inbound MCP server call. Single validation authority, two entry points —
    exactly Palmier's architecture.
  - Connector plumbing for *outbound* MCP already exists (`src/lib/mcp-connector.ts`,
    beta `mcp-client-2025-11-20`); the new work is the *server* side + the ops module.

---

## 3. Build vs integrate

| Option | What it means | Verdict |
| --- | --- | --- |
| **Drive Palmier via its MCP** | Spin up macOS boxes per tenant, drive Palmier over `127.0.0.1:19789` | **No.** It's a local, single-user, non-sandboxed macOS-26 desktop app. Not multi-tenant, not server-rentable, GPLv3 obligations, and we'd be paying their credits with no margin. Fundamentally mismatched with web/Vercel/Supabase. |
| **Build native + expose our own MCP** | Extend our existing Composition/timeline/canvas/provider registry; ship an inbound MCP server | **Yes.** We already have ~70% of the surface area. |

**Recommendation: build native, steal the patterns.** We are *not* starting from
zero — we have the timeline, the React-Flow generation canvas, the provider adapter
registry, the per-tenant BYO-key store, the Vercel-Blob asset library, a working
HeyGen render, AND proven client-side ffmpeg.wasm. The build is **filling gaps +
adding the MCP/ToolExecutor layer**, not writing an NLE.

---

## 4. Phased build plan

Each phase reuses named, existing code and is independently shippable. Risky/cost
features default OFF behind the existing Connections/Autonomy gating.

### Phase 0 — Unify what we have (1 surface, plumbing only)
*Make the canvas + timeline + render feel like one "AI Video Editor."*
- Land the canvas (`canvas-board.tsx`) and timeline (`timeline.tsx`) in one
  Content-hub route as two views of the **same** `Composition`. `assemble` already
  bridges canvas → draft → `/content/hyperframes/[id]`; tighten that hand-off.
- No new infra. This is the "stop feeling like 3 features" pass.

### Phase 1 — In-timeline generation as a primitive (the core Palmier idea)
*Generate a clip directly on a scene; the scene remembers prompt+model+refs.*
- Extend `CompositionScene` (or `SceneBackground`) with an optional
  `generation: { provider, prompt, refImageUrls?, model?, jobId?, externalId? }` so a
  scene's background can be a **live, regenerable** generation, not just a static URL.
  (Mirrors Palmier's "prompt+model+refs attached to the clip.")
- A "Generate / Regenerate" affordance on a timeline scene reusing the
  `/api/generation/run` → `MediaProvider.submit/poll` path that the canvas already
  uses. Output lands in `tenant_assets` (via `uploadGenerated`) and becomes the scene
  background. **Regenerate-in-place** = re-run with the stored prompt/refs.
- First/last-frame + reference-image inputs map onto `GenInput` (`imageUrl` already
  exists; add `refImageUrls`).
- **Reuses:** `media-providers/*`, `/api/generation/run`, `assets.ts`. New: schema
  field + a scene-level UI button + poll wiring (the canvas already polls jobs).

### Phase 2 — Broaden the model roster (Palmier parity)
*Veo + Nano Banana → + Kling / Seedance / Grok.*
- Add **one fal.ai adapter** (`media-providers/fal.ts`) taking a model id per call,
  BYO fal key in `integrations-store` (new provider tile, same pattern as `google-ai`).
  One adapter unlocks Kling V3, Seedance, etc. without six integrations.
- Add a `falKey()` getter alongside `getGoogleAiKey()`. Register in
  `media-providers/index.ts`. Node UI gets a model dropdown.
- *Optional:* Vercel AI Gateway as a unifying layer if we want one bill +
  observability across providers (vs pure BYO-key). Decide on margin model first.

### Phase 3 — The shared `ToolExecutor` + agent drive (our moat)
*The hyperframes-agent edits the timeline, not just writes a script.*
- Extract a **`src/lib/composition-ops.ts`** = the single validated mutation API:
  `addScene`, `setSceneClip`, `splitScene`, `setCaptions`, `addOverlay`,
  `setInfographic`, `generateForScene`, plus read ops `getComposition`,
  `searchMedia` (over `buildClipCatalog`). This is Palmier's `ToolExecutor`, ported.
- Wire these as **tools on `spawnSubAgent('hyperframes-agent', …)`** so the agent
  goes brief → storyboard → **builds the actual Composition** → triggers render.
  Today the agent only emits markdown (`hyperframes-composition.ts` parses it); now
  it mutates the composition directly. (`subagent.ts` already supports per-agent tools
  + the multi-turn `tool_use` loop.)
- Keep the `RICH_FORMAT_GUIDE` as the schema the agent is taught.

### Phase 4 — Inbound MCP server (literal "Palmier for agencies")
*A client's own Claude/Cursor drives THEIR tenant's editor.*
- Expose a hosted HTTP MCP endpoint (`/api/mcp/video-editor`) whose tools are thin
  wrappers over `composition-ops.ts` — **same authority, second entry point**, exactly
  Palmier's design. Tenant-scoped via the existing `resolveTenant()`/`enterTenant`
  pattern; auth via a per-tenant MCP token.
- Tool names mirror Palmier so existing muscle memory transfers: `get_timeline`,
  `add_clips`, `split_clip`, `set_clip_properties`, `generate_video`, `search_media`.

### Phase 5 — Tiered render + NLE export
- **Browser preview/export:** generalize the `supercut-panel` ffmpeg.wasm pipeline
  into a `Composition`-aware client renderer for cuts-only/preview (instant, free).
- **HeyGen** stays the motion-graphics quality path (`heygen-render.ts`).
- **NLE export:** `compositionToFcpxml(comp)` + `compositionToEdl(comp)` next to
  `hyperframes-html.ts`. "Generate here, finish in Premiere/DaVinci." Cheap, sticky.
- **Heavy render worker** (4K/long) deferred until demand — `hyperframes lambda` or a
  container running the CLI.

### Phase 6 — Publish loop (already planned)
- Inherit `plans/hyperframes-hub.md` Phase 3: agent renders → draft with Blob URL →
  owner Approve → `publishContent()` uploads to YouTube/IG. This is the part Palmier
  *structurally cannot do* — lean into it.

---

## 5. Risks / open questions
- **Model costs & margin.** Veo/Kling/Seedance are expensive. BYO-key (per-tenant
  Google/fal key, our current pattern) pushes cost to the client and is the safe
  default; an AI-Gateway/credit model needs a real margin decision. Gate behind the
  per-tenant token/usage caps that already exist.
- **Client media / legal.** Generated footage + uploaded client footage + movie-clip
  supercuts (PlayPhrase) have different rights profiles. The supercut path is already
  flagged as risky; keep gen-media licensing per-provider and surface attribution.
- **Cross-origin.** ffmpeg.wasm needs CORS-fetchable sources; we control this for
  Vercel-Blob assets but **not** for provider CDNs (Veo URIs need the API key header,
  see `veo.ts` `fetch.headers`) — server-proxy those into Blob before client edit.
- **Vercel compute limits.** No headless Chrome / heavy ffmpeg in a function. That's
  *why* render is tiered (client wasm / HeyGen cloud / future worker). Don't try to
  render server-side in a route.
- **MCP auth surface.** An inbound MCP server is a new authenticated mutation path —
  must ride `resolveTenant()` fail-closed and per-tenant tokens, never trust the tool
  args (the whole point of the `ToolExecutor`/`composition-ops` validation layer).
- **Native-quality gap.** AVFoundation gives Palmier frame-accurate scrub/playback for
  free; our web timeline preview will trail a desktop NLE. Accept it — our buyer is a
  marketer/agent, not a colorist.

---

## 6. What to steal (highest-leverage)
1. **Generation as a timeline primitive** — clip carries `{prompt, model, refs}` and
   **regenerates in place**. This is *the* idea; everything else is plumbing. Maps onto
   a `generation` field on `CompositionScene` + the existing `/api/generation/run`.
2. **One `ToolExecutor`, two entry points** — a single validated
   `composition-ops.ts` that both our internal `hyperframes-agent` and an inbound MCP
   server call. Clean, secure, and it's the seam that makes the editor "agent-drivable."
3. **NLE XML export (FCPXML/EDL)** — trivial to generate from our `Composition`, and it
   converts "AI toy" into "fits my real Premiere/DaVinci workflow." Disproportionate
   trust/credibility per line of code.
4. **BYO-Anthropic-key chat + per-provider BYO model keys** — exactly our existing
   `integrations-store` pattern; keeps gen cost off our books by default and matches
   how Palmier de-risks its own credit exposure.

---

### Sources
- https://www.palmier.io/ , /docs , /pricing
- https://github.com/palmier-io/palmier-pro (README) ; https://deepwiki.com/palmier-io/palmier-pro/7-ai-agent-and-mcp-integration
- https://www.ycombinator.com/launches/QtT-palmier-pro-an-open-source-video-editor-your-agents-can-operate ; https://www.ycombinator.com/companies/palmier
- https://www.eesel.ai/blog/what-is-palmier-ai-video-editor ; https://outlierkit.com/resources/palmier-review/ ; https://www.producthunt.com/products/palmier
- Our stack: `src/lib/media-providers/{index,types,veo,nanobanana}.ts`, `src/lib/hyperframes-composition.ts`, `src/lib/hyperframes-clips.ts`, `src/lib/assets.ts`, `src/lib/heygen.ts`, `src/lib/heygen-render.ts`, `src/lib/integrations-store.ts`, `src/lib/subagent.ts`, `src/lib/mcp-connector.ts`, `src/lib/supercut.ts`, `src/lib/timeline-model.ts`, `src/components/hyperframes/{timeline,supercut-panel,clip-finder}.tsx`, `src/components/hyperframes/canvas/canvas-board.tsx`, `src/app/api/generation/{run,assemble}/route.ts` ; sibling plan `plans/hyperframes-hub.md`
