# Claude Mascot Animations (real SVG assets + GSAP)

A recreation of Claude AI's mascot animations, following the Codrops article
[_Reverse-engineering Claude AI's mascot animations with SVG and GSAP_](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/).

These now use the **real Claude mascot SVG assets** in `public/sprites/` (rect-based SVGs that
carry the article's exact element ids + baked-in `data-svg-origin`). Each animation **injects** its
SVG at runtime (fetch the file → set the host `innerHTML`), then queries the injected DOM nodes and
drives them with GSAP. Cleanup uses `gsap.context()` + `ctx.revert()` / `tl.kill()` on unmount.

Live demo route: **`/mascot`** (`src/app/mascot/page.tsx`) — all four animations with play/pause +
restart, plus the synthetic `MascotDance` idle.

## The assets (`public/sprites/`)

| File | viewBox | Kind | Notes |
| --- | --- | --- | --- |
| `claude-walking.svg` | `0 0 107 86` | tweened rig | one mascot, real ids: `ground-clip`, `leg1`–`leg4`, `body`, `bdy`, `left-hand`, `right-hand`, `left-eyes`, `right-eyes`. |
| `claude-gym.svg` | `0 0 140 146` | frame groups | 12 lift frames. |
| `claude-flag-waver.svg` | `0 0 158 128` | frame groups | 36 wave frames. |
| `claude-confetti.svg` | `0 0 129 113` | frame groups | 8 stomp frames `l001`–`l008`. |

## Components

| Component | File | Asset | Summary |
| --- | --- | --- | --- |
| `WalkingClaude` | `walking-claude.tsx` | `claude-walking.svg` | Tweened walk/jump/leap loop on the real rig. |
| `GymClaude` | `gym-claude.tsx` | `claude-gym.svg` | Frame-cycled lift (12 frames, apex + rest holds). |
| `FlagWaver` | `flag-waver.tsx` | `claude-flag-waver.svg` | Frame-cycled wave (36 frames, ~0.09s/frame). |
| `ConfettiClaude` | `confetti-claude.tsx` | `claude-confetti.svg` | Frame-cycled stomp (8 frames, ~0.085s/frame). |
| `MascotDance` | `mascot-dance.tsx` | _none (synthetic)_ | Compact `<rect>` idle bob/wiggle/squash for riding a progress bar. |
| `FrameSvg` | `frame-svg.tsx` | _generic_ | Reusable frame-group cycling engine used by the three frame animations. |
| `useInjectedSvg` | `use-injected-svg.ts` | _generic_ | Hook: fetch + inject an SVG, return its live root element. |

Import from the barrel:

```ts
import { WalkingClaude, GymClaude, FlagWaver, ConfettiClaude, MascotDance } from "@/components/mascot";
```

## How injection works (`useInjectedSvg`)

```ts
const { hostRef, svg } = useInjectedSvg("/sprites/claude-gym.svg");
// host <div ref={hostRef}> gets innerHTML = fetched markup
// `svg` is the live <svg> element once injected (null until ready)
```

Runtime fetch + `innerHTML` (rather than importing the markup) keeps the large frame SVGs
(gym ~57KB, flag ~54KB) out of the JS bundle, lets the browser cache them, and preserves the
authored ids + `data-svg-origin` exactly. The hook strips `width`/`height` so the SVG fills its
host box (responsive via the authored `viewBox`).

## Frame-group cycling (`FrameSvg`)

The frame animations stack many frame `<g>` groups in one SVG; exactly one is `display:inline`
and the rest are `display:none`. Playing the animation = a looping GSAP timeline that flips which
group is `inline`, advancing a `time` cursor by a per-frame hold value:

```ts
frames.forEach((g) => gsap.set(g, { display: "none" }));   // start hidden
const tl = gsap.timeline({ repeat: -1 });
let time = 0;
for (let i = 0; i < order.length; i++) {
  const frameIdx = order[i];
  frames.forEach((g, j) => tl.set(g, { display: j === frameIdx ? "inline" : "none" }, time));
  time += getDelay(i, frameIdx);
}
```

### How the frame groups were detected per SVG

The frame groups are identified directly from the live injected DOM via `frameSelectors`:

- **gym** (`frameSelectors.byDisplayStyle`): the file is one outer transform `<g>` wrapping a static
  base (foot shadows + a lean sub-rig) plus 12 **nested** frame `<g>`s. Those 12 are the **only**
  `<g>` elements carrying an explicit inline `display` (11 `none` + 1 `inline`), so selecting every
  `<g>` with a `display` style/attr returns exactly the 12 lift frames in document (play) order.
- **flag** (`frameSelectors.byDisplayStyle`): a flat list of **36** top-level `<g>` siblings, each a
  full illustrated frame (body + waving hand + flag baked in). Exactly one starts `inline`; all 36
  are the only display-bearing `<g>`, so the same selector returns all 36 in order.
- **confetti** (`frameSelectors.byIdPrefix("l0")`): the 8 frames are explicitly id'd `l001`–`l008`.
  An id selector is used here (not the display detector) because each frame also nests decorative
  confetti-particle `<g>`s that themselves carry `display`, which would otherwise read as false
  frames.

(The counts were confirmed by walking each SVG's `<g>` depth/display structure before wiring.)

### Per-frame timing

- **GymClaude** — default `0.085s`; longer `0.27s` holds near the apex of the lift (the strain); a
  `1.5s` rest on the final frame before looping. _(The published article worked a 36-frame asset
  with holds at frames 6/7 = 0.27s, 15/21 = 0.4s, last = 1.5s; the real shipped asset is 12 frames,
  so that intent is mapped onto the actual frames.)_
- **FlagWaver** — steady `0.09s` per frame across all 36 (the loose flag-wave cadence). Hand sway +
  cloth are baked into each frame, so no overlay tweens are needed.
- **ConfettiClaude** — steady `0.085s` per frame. The confetti bursts are baked into the 8 frames,
  so it is pure frame-cycling (no synthesised particle overlay).

## WalkingClaude — the tweened rig

`WalkingClaude` injects `claude-walking.svg`, strips the asset's baked mid-animation transforms to a
neutral pose, then runs the article's GSAP timeline against the **real ids**:

- **Lean** — eyes + `#body` + legs fire together via the `"<"` position param, `0.4s` `power2.out`.
  Body `rotation: -3`, `svgOrigin "53 65"`. Legs get per-element `rotation: (i) => [-7,-8,-8,-9][i]`
  and `scaleY: (i) => [1.35,1.3,1.2,1.15][i]`.
- **Leg pivot swap** — a `.call()` swaps each leg's `svgOrigin` from the **hip** (top of the rect,
  `y=60`) to the **feet** (bottom, `y=86`) so the lean stretches from the floor while the walk
  pivots from the hip, then swaps back.
- **Crouch** — `#body` `y += 8` (`0.1s` `power3.in`) with the hands dropping in parallel.
- **Jump** — timeline labels + relative offsets: horizontal `0.85s` `power1.inOut`; vertical ascent
  to `-90` over `0.42s` `sine.out`; descent over `0.2s` `power3.in` at `jump+=0.6`; a tiny
  hand-landing overshoot (`0.05s`) with an elastic settle.
- Then walk across (alternating leg swings), look down, crouch + leap back, reset. Loops forever.

## Props

### `WalkingClaude`
- `size?: number` (default 240) — width; height keeps the 107×86 aspect.
- `jumpDist?: number` (default 60) — horizontal leap distance applied to the outer `<g>`.
- `autoPlay?: boolean` (default true)
- `className?: string`
- `onTimeline?: (tl) => void` — receives the master timeline for external play/pause/restart.

### `GymClaude` / `FlagWaver` / `ConfettiClaude`
- `size?: number` (default 220), `className?: string`, `playing?: boolean` (default true),
  `onTimeline?: (tl) => void`.

### `MascotDance`
- `size?: number` (default 30) — crisp at 24–34px; scales up fine.
- `color?: string`, `className?: string`, `playing?: boolean` (default true).

### `FrameSvg` (base engine)
- `src: string` — path under `/public`.
- `selectFrames: (svg) => SVGGElement[]` — return frame groups in play order (use `frameSelectors`).
- `getDelay?: (playIndex, frameIndex) => number` — per-frame hold (default `0.085s`).
- `sequence?: (frameCount) => number[]` — optional explicit play order (repeat frames here).
- `buildExtra?: (tl, { svg, frames, times }) => void` — attach extra tweens, phase-aligned to frames.
- `size?`, `className?`, `playing?`, `onTimeline?`, `aria-label?`.

## GSAP techniques used

- **`gsap.context(fn, scopeRef)`** scopes selectors; `ctx.revert()` + `tl.kill()` on unmount kills
  every tween and restores inline styles for clean React cleanup.
- **The `"<"` position parameter** fires the lean's eyes/body/legs tweens simultaneously.
- **Function-based values** — `rotation: (i) => [...][i]` — give each leg its own target in one `.to()`.
- **`svgOrigin`** sets the transform origin in SVG user units (body `"53 65"`; legs hip↔feet via `.call()`).
- **`clipPath` `ground-clip`** masks stretched legs at the ground line.
- **Timeline labels + relative offsets** (`"jump"`, `"jump+=0.6"`, `">"`, `">-0.02"`) compose the arc.
- **Frame sprites** toggle visibility with `gsap.set(el, { display })` on a timeline, advancing a
  `time` cursor by `getDelay()` per beat.
