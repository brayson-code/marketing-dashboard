// Camera for the Second Brain graph — PURE.
//
// The nodes never move. The camera does: a pure function from "what is focused" to an
// SVG viewBox, plus an easing step run once per animation frame. That separation is the
// whole reason this can feel alive without ever wobbling — the expensive deterministic
// layout is computed once, and everything that moves afterwards is the frame.

export interface Rect { x: number; y: number; w: number; h: number }

/** Glide IN at 0.075, SNAP home at 0.3. Asymmetric on purpose: travelling into a node
 *  is a considered move, backing out is an escape. It's a film-editing instinct applied
 *  to a UI, and it's most of why the navigation feels intentional rather than twitchy. */
export const CAM_EASE_IN = 0.075;
export const CAM_EASE_HOME = 0.3;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Frame the view on a point at a given fraction of full size, clamped so a node near
 *  the edge can't pan the camera into empty space. */
export function frameOn(view: number, cx: number, cy: number, frac: number): Rect {
  const w = view * frac;
  const h = w;
  const x = Math.max(0, Math.min(view - w, cx - w / 2));
  const y = Math.max(0, Math.min(view - h, cy - h / 2));
  return { x: r2(x), y: r2(y), w: r2(w), h: r2(h) };
}

export function restingFrame(view: number, pad = 0.02): Rect {
  return { x: r2(-view * pad), y: r2(-view * pad), w: r2(view * (1 + 2 * pad)), h: r2(view * (1 + 2 * pad)) };
}

/**
 * Step the camera toward its target.
 *
 * The `done` check is not an optimisation — without it an exponential ease asymptotes
 * forever and the camera never actually stops, which reads as a permanent low-level
 * jitter. Snap to the exact target once every edge is within 0.05.
 */
export function lerpRect(cur: Rect, target: Rect, t: number): Rect {
  if (t >= 1) return target; // reduced-motion path: teleport
  const done =
    Math.abs(cur.x - target.x) < 0.05 &&
    Math.abs(cur.y - target.y) < 0.05 &&
    Math.abs(cur.w - target.w) < 0.05 &&
    Math.abs(cur.h - target.h) < 0.05;
  if (done) return target;
  return {
    x: cur.x + (target.x - cur.x) * t,
    y: cur.y + (target.y - cur.y) * t,
    w: cur.w + (target.w - cur.w) * t,
    h: cur.h + (target.h - cur.h) * t,
  };
}

export const rectStr = (r: Rect) => `${r.x} ${r.y} ${r.w} ${r.h}`;
