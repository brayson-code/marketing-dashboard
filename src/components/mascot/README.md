# Claude Mascot Animations (SVG + GSAP)

A faithful recreation of Claude AI's mascot animations, following the Codrops article
[_Reverse-engineering Claude AI's mascot animations with SVG and GSAP_](https://tympanus.net/codrops/2026/05/05/reverse-engineering-claude-ais-mascot-animations-with-svg-and-gsap/).

Everything is built from **`<rect>` elements only** — no paths or curves — grouped so each
body part (body, 4 legs, eyes, left/right hands) can be transformed independently. GSAP drives
the parts via `useRef` + `gsap.context()`, and a `<clipPath id="ground-clip">` keeps stretched
legs from crossing the ground line.

Live demo route: **`/mascot`** (`src/app/mascot/page.tsx`).

## Components

| Component | File | Art needed? | Summary |
| --- | --- | --- | --- |
| `MascotArt` | `mascot-art.tsx` | No | Static `<rect>`-only mascot; exposes inner parts via `onParts`. |
| `WalkingClaude` | `walking-claude.tsx` | No | Full pure-GSAP walk/jump/leap loop. Built completely. |
| `MascotDance` | `mascot-dance.tsx` | No | Compact idle bob/wiggle/squash loop for riding a progress bar. |
| `SpriteClaude` | `sprite-claude.tsx` | Yes (frames) | Generic frame-toggle engine + placeholder. |
| `GymClaude` | `gym-claude.tsx` | Yes | Lifting sprite (36 frames / 48 beats). |
| `ConfettiClaude` | `confetti-claude.tsx` | Yes | Stomping sprite + mirrored confetti bursts. |
| `FlagWaver` | `flag-waver.tsx` | Yes | Flag-wave sprite + hand/sway offset tables. |

Import from the barrel:

```ts
import { WalkingClaude, MascotDance, GymClaude, ConfettiClaude, FlagWaver } from "@/components/mascot";
```

## Props

### `MascotArt`
- `size?: number` (default 220) — width in px; height keeps the 120×96 aspect.
- `color?: string` (default `#DD775B`, the Claude coral).
- `className?: string`
- `onParts?: (parts: MascotPartRefs) => void` — direct refs to every animatable part.

### `WalkingClaude`
- `size?: number` (default 240)
- `color?: string`
- `className?: string`
- `jumpDist?: number` (default 60) — horizontal leap distance applied to the wrapping `<g>`.
- `autoPlay?: boolean` (default true)
- `onTimeline?: (tl) => void` — receives the master timeline for external play/pause/restart.

### `MascotDance` (priority integration)
- `size?: number` (default 30) — designed crisp at 24–34px; scales up fine.
- `color?: string`
- `className?: string`
- `playing?: boolean` (default true) — play/pause without rebuilding the timeline.

### `SpriteClaude` (base engine)
- `frameSrcs?: string[]` — ordered frame image URLs. Absent ⇒ placeholder.
- `frameSequence?: number[]` — playback order over frames (repeat frames here).
- `getDelay?: (seqIdx, frame) => number` — per-beat hold time in seconds (default 0.085).
- `viewWidth?` / `viewHeight?` (default 240) / `size?` (default 240)
- `playing?: boolean`, `className?`, `placeholderLabel?`, `expectedFrames?`
- `overlay?: ReactNode` — extra `<g>` layers rendered into the same `<svg>`.
- `buildExtra?: (tl, { root }) => void` — attach extra tweens inside the gsap context.
- `onTimeline?: (tl) => void`

### `GymClaude` / `ConfettiClaude` / `FlagWaver`
- `frameSrcs?: string[]`, `size?: number`, `className?: string`, `playing?: boolean`.

## GSAP techniques used

- **`gsap.context(fn, scopeRef)`** scopes selectors and lets `ctx.revert()` kill every tween and
  restore inline styles on unmount — clean React cleanup (`return () => ctx.revert()`).
- **The `"<"` position parameter** fires the lean's eyes/body/legs tweens simultaneously.
- **Function-based values** — `rotation: (i) => [-7,-8,-8,-9][i]`, `scaleY: (i) => [1.35,1.3,1.2,1.15][i]` —
  give each leg its own target in one `.to()`.
- **`svgOrigin`** sets transform origin in SVG user units. The body pivots at `"53 65"`; legs are
  switched between a HIP origin (top of the rect) and a FEET origin (bottom, y=86) via **`.call()`**
  mid-timeline so the lean stretches from the floor while the walk pivots from the hip.
- **`clipPath` "ground-clip"** masks stretched legs at the ground line.
- **Timeline labels + relative offsets** — `addLabel("jump")`, then `"jump"`, `"jump+=0.6"`,
  `">"`, `">-0.02"` — compose the parabolic arc (horizontal `power1.inOut` 0.85s; ascent to `-90`
  `sine.out` 0.42s; descent `power3.in` 0.2s; hand-landing overshoot 0.05s with an elastic settle).
- **Frame sprites** toggle visibility with `gsap.set(el, { display: ... })` on a timeline, advancing
  a `time` cursor by `getDelay()` per beat.
- **Independent synchronized timelines** — confetti bursts are separate `gsap.timeline({ delay })`s
  (first at `+1` frame, second at `+6` frames) nested into the master so play/pause cascades.

## Frame art — what to drop in (still needed)

Place PNG (or SVG) frames in `public/` and pass their paths as `frameSrcs`. Frames should be
square (recommend **240×240px**, transparent background) matching the 240×240 sprite viewBox.
Numbering is **zero-padded, starting at `00`**, played in filename order.

### FlagWaver — `public/sprites/flag/`
12 frames: `00.png` … `11.png` (240×240).
The component already supplies the per-frame hand offset and body sway tables:
- `handExtraX = [0,-6,-12,-14,-8,-2,0,0,-4,-10,-16,-18]`
- `swayX      = [0,0,-5,-5,0,4,4,4,0,0,-5,-5]`

### ConfettiClaude (stomping) — `public/sprites/stomp/`
8 frames: `00.png` … `07.png` (240×240).
Confetti bursts are generated procedurally (mirrored second burst), so only the stomping body
frames are needed. Particle arc offsets: `[-65,-72,-76,-70,-58,-42,-22,0]`.

### GymClaude (lifting) — `public/sprites/gym/`
36 frames: `00.png` … `35.png` (240×240).
Played as 48 beats with frames 13–24 repeated. Hold-time table:
- default `0.085s`; frames 6 & 7 `0.27s`; frames 15 & 21 `0.4s`; final beat `1.5s`.

Example wiring once art exists:

```tsx
const flagFrames = Array.from({ length: 12 }, (_, i) => `/sprites/flag/${String(i).padStart(2, "0")}.png`);
<FlagWaver frameSrcs={flagFrames} />
```
