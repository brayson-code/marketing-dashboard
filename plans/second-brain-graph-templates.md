# Second Brain, org chart, templates — build plan

> Status: **PLAN ONLY** (2026-08-04). Written against Mitch's
> `SPECgraphorgtemplates.md` hand-off spec. No code changed to write this.
> Ground rule from Mitch: **"I don't want to rewire anything. I just want to make
> it look different."** So everything below is a rendering change unless the line
> says otherwise — and the lines that say otherwise are flagged loudly.

---

## 1. What we actually have (measured, production DB)

| | Reality |
|---|---|
| Entities | **656** across **15** kinds |
| By kind | topic 183, company 170, product 114, person 57, metric 41, event 25, project 18, campaign 9, goal 9, channel 8, document 7, content 7, tool 4, skill 3, platform 1 |
| Relations | **559** |
| Current graph component | `src/components/kg-graph.tsx` — **339 lines** |
| Spec's constellation | **~2,400 lines** |
| Page | `/kg`, gated behind `UpgradeGate` (Pro feature) |

## 2. Where the spec and our data disagree

The spec was written against an **Obsidian-style note vault**. We do not have one.
This is the single most important thing to understand before starting.

| Spec assumes | We have | Consequence |
|---|---|---|
| Pages with **wikilinks** | `kg_relations` (one relation table) | The per-edge-type springs (§A.4) need remapping |
| **Folder** membership | No folders | Use `kind` as the grouping axis instead |
| **kNN similarity** from embeddings | No embeddings on `kg_entities` | Drop the `similar` spring, or derive from shared neighbours |
| **PCA** seed coordinates | No vectors to run PCA on | Seed from a deterministic hash + golden angle instead |
| 6 node kinds | **15** kinds | Need a kind → visual-tier mapping (see 4.2) |
| ~120 nodes | **656** | The LOD/cap work in §A.8 is **mandatory**, not optional |

**None of this blocks the look.** The spec's value is 90% rendering and motion —
determinism, layered ambience, camera easing, size-over-opacity hierarchy. All of
that transfers. What doesn't transfer is the *seed* and the *spring taxonomy*,
and those are ~40 lines.

## 3. ⚠️ The decision that has to come first

**Part 0 is not a graph change. It restyles the entire product.**

The spec's foundation is a monochrome terminal theme:
`--accent: #f2f2f2` (the accent *is* white), `--bg: #0a0a0a`, **zero border
radius everywhere**, **JetBrains Mono as the only typeface**, and a governing rule
that **colour means status only** — the sole hues permitted are ok/warn/err.

That is a coherent, good-looking system. It is also:

- a different brand from KeyPlayers (green, premium, warm, rounded), and
- close to the opposite of the direction given earlier in this project —
  *"more fun, more floating, more gradient, almost. Maybe just more clean."*

A monochrome, square-cornered, all-mono-type terminal is none of those things.

**Three options — Mitch picks one before any work starts:**

- **(A) Graph-only.** Adopt the spec's *motion and structure*, keep KeyPlayers
  colour and type. Lowest risk, no impact on any other page. *Recommended.*
- **(B) Scoped theme.** Build the mono palette as a real theme, applied only to
  the Second Brain surface, so it reads as an instrument inside a warmer app.
- **(C) Whole-app.** Adopt Part 0 across the product. This is a full rebrand of
  the Command Centre and should be its own project with its own approval.

---

## 4. The to-do list

Ordered so each item is shippable on its own and the risky work comes last.
Sizes: **S** ≈ under an hour, **M** ≈ a few hours, **L** ≈ a day or more.

### Phase 1 — Foundation

- [ ] **1.1 Decide Part 0 scope (A / B / C above).** Blocks everything visual. — *Mitch*
- [ ] **1.2 The one easing curve.** `--ease: cubic-bezier(0.32, 0.72, 0, 1)` on a
      bare `:root`, never inside a theme block. **S**
- [ ] **1.3 Status dots.** Square 6px, `steps()` LED blink, and the
      `dotState()` table that **defaults unknown → `off`, never `ok`**. **S**
- [ ] **1.4 Press feedback 2.5× faster than hover** (`.15s` hover, `.06s` active).
      Tiny; it is most of why the UI feels responsive. **S**

### Phase 2 — The core instrument (do this before the big graph)

The spec is explicit: build this first. ~170 lines, **server-rendered**, no state,
and it gives a Second Brain presence on any page for almost nothing.

- [ ] **2.1 `polar()` helper with 2-decimal rounding.** Not cosmetic — raw floats
      stringify differently server vs client and React warns on hydration. **S**
- [ ] **2.2 Cluster layout from entity `kind`.** Cap at 6 clusters, fold the tail
      into `misc` (we have 15 kinds, so this matters). **M**
- [ ] **2.3 The three rings** — 210 / 158 / 108, **middle ring counter-rotating**,
      220s / 140s / 80s. The counter-rotation is what sells it as machinery. **M**
- [ ] **2.4 Ring marks** — outer sampled dots, middle diamonds, inner spoked nodes
      with the 30%-opacity halo ring (glow with no filter). **M**
- [ ] **2.5 Health gauge** — `strokeDasharray` arc, rotated −90°, 3.2s breathe at
      **3.5%**. Render a missing value as an em dash, **never a fake zero**. **S**
- [ ] **2.6 Radar sweep** — one wedge, 0 → 13% gradient, 9s. **S**
- [ ] **2.7 Keep the SVG pure.** Interactivity wraps it; the SVG never gains
      state. **S**

### Phase 3 — The constellation graph

- [ ] **3.1 Deterministic layout as a BUILD STEP.** `hashId` instead of
      `Math.random`, `FORCE_ITERS = 260`, array iteration order, 4-decimal
      rounding. **This is the entire answer to the wobble.** **M**
- [ ] **3.2 Adapt the seed** — no PCA available, so hash + golden angle. **S**
- [ ] **3.3 Adapt the springs to our relation types.** The spec's character lives
      in four numbers; ours will need its own four. **M**
- [ ] **3.4 Node kind → visual tier mapping.** 15 kinds → radius/colour tiers.
      Keep two rules: **humans render in the warn colour**, and **hierarchy is
      size, not opacity** (the spec records dimming as a reversal — it read as
      "broken" from zoomed out). **M**
- [ ] **3.5 Duplicate shared leaves** so a tool used by three departments becomes
      three local nodes instead of three long edges. Removes most spaghetti. **M**
- [ ] **3.6 Islands placed, not drifting** — union-find, largest holds centre,
      others spaced **evenly** (golden-angle looks lopsided at 2–3 islands). **M**
- [ ] **3.7 Dead-zone gravity** — applies only to the excess beyond the island
      radius. Constant gravity crushes clusters into their anchor. **S**
- [ ] **3.8 Static render first, no animation.** Ship and look at it. **M**
- [ ] **3.9 LOD / node cap.** 656 → ~120, chosen **round-robin across 12 angular
      sectors** so thinning doesn't leave a bald patch, returned in original order
      so layer assignment stays stable. **Mandatory at our size.** **M**

### Phase 4 — Motion

- [ ] **4.1 Camera, not nodes.** `cameraRect` + `lerpRect` + rAF loop. **M**
- [ ] **4.2 Asymmetric easing** — glide in `0.075`, **snap home `0.3`**; 900ms
      open, 450ms close. Most of why navigation feels intentional. **S**
- [ ] **4.3 Snap to target within 0.05** or the camera asymptotes forever and
      never truly stops. **S**
- [ ] **4.4 Three animation layers, not N node animations.** Non-harmonic
      durations (19/24/29, 6.5/8.5/11) with negative delays so they never sync.
      Six animations produce the illusion of hundreds. **M**
- [ ] **4.5 Hover stir via `animation-play-state`** — exists but paused, so it
      costs nothing until used. **S**
- [ ] **4.6 Synapse sparks** — 14, deterministic hash walk, `setAttribute` in the
      rAF loop, **never React state per frame**. **M**
- [ ] **4.7 Pause ambience during camera moves.** Give the transition the whole
      frame budget. **S**
- [ ] **4.8 Idle throttle** — every 3rd frame after 15s, with `dt` spanning the
      skipped frames so the speed looks identical. **S**
- [ ] **4.9 Skip DOM writes when unchanged** — rewriting an identical transform
      invalidates the whole subtree's paint and halves the frame rate. **S**

### Phase 5 — Org chart (Part B)

- [ ] **5.1 CSS connectors, not SVG** — pseudo-element stubs, rail inset by half
      a column. Reflows for free, no measurement. **M**
- [ ] **5.2 Conductor emblem** — quotes the core instrument's ring so the two
      surfaces read as one system. **Idle = completely still.** **M**
- [ ] **5.3 Thinking state** — halo rests at 70%, breathe warms the border colour,
      periods that don't divide (1.1s vs 1.9s). **S**
- [ ] **5.4 Filtering dims to 20%, never hides.** The shape of the org has to
      survive the filter. **S**
- [ ] **5.5 Wide breakpoints** (1800 / 2200) so the chart breathes on a big
      monitor instead of stretching. **S**

### Phase 6 — Templates (Part C)

⚠️ **This is the one item that is NOT a re-skin.** Nothing like it exists in the
codebase today — no personas, no template model, no viewer. It is a net-new
feature plus a content-authoring job (11 templates × 5 pillars × 4 agents = 220
agent names to write).

- [ ] **6.1 Answer: what are templates FOR?** Are they a sales/marketing artifact
      that shows a prospect what their Command Centre would look like, or do they
      actually **configure a workspace** on selection? Completely different builds.
      Blocks the rest of Phase 6. — *Mitch*
- [ ] **6.2 Persona model** — 5 pillars × 4 agents, uniform by design so the
      generated cover chart is a fixed shape. **M**
- [ ] **6.3 Generated SVG cover** — 760×150, five fixed bands, **weight encodes
      depth** (1.2px/0.5 → 1.0px/0.4). Namespace gradient ids per instance or
      multiple cards on a page collide. **M**
- [ ] **6.4 Card anatomy** — six ruled bands; only the signature-play band is
      tinted, via `color-mix(… 9%, var(--surface))` so it stays right on a light
      theme. **M**
- [ ] **6.5 Viewer** — one at a time, arrow keys (guarded against inputs),
      **arrows fixed in place while the label changes beside them**. **M**
- [ ] **6.6 Accents as tokens, not hex literals.** The spec flags this as its own
      unresolved debt — worth fixing on the way in rather than inheriting. **S**

---

## 5. Risk notes

- `/kg` is **live client data**, unlike Personal Life and Founder Profile which
  were new surfaces. Every change here is to something people already use, so each
  phase ships behind its own tag and gets looked at before the next one starts.
- The graph is gated Pro (`planAllowsKg`). Don't let a re-skin drop the gate.
- Phase 3 replaces `kg-graph.tsx` (339 lines) with something an order of magnitude
  larger. That is the point where "just make it look different" stops being
  strictly true, and it should be reviewed as a rewrite, not a restyle.
