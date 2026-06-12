// Pure, side-effect-free timeline model helpers for the Hyperframes timeline
// editor. No React, no DOM — unit-testable with node:test.
//
// Unit system recap (from hyperframes-composition.ts):
//   • Composition scenes use MILLISECONDS (startMs / endMs) on the reel timeline.
//   • Overlays / infographics / punch-beats use SECONDS relative to their
//     scene's start. These are the "inner" coordinates.
//
// The timeline ruler converts between milliseconds and screen pixels using a
// zoom factor measured in pixels-per-second (px/s).

import type {
  Composition,
  CompositionScene,
  Infographic,
} from './hyperframes-composition';

// ── px ↔ ms conversion ───────────────────────────────────────────────────────

/** Convert milliseconds to pixels at the given px/s zoom. */
export function msToPx(ms: number, pxPerSec: number): number {
  return (ms / 1000) * pxPerSec;
}

/** Convert pixels to milliseconds at the given px/s zoom. */
export function pxToMs(px: number, pxPerSec: number): number {
  return (px / pxPerSec) * 1000;
}

// ── deep-clone helpers ───────────────────────────────────────────────────────

function cloneComp(comp: Composition): Composition {
  return JSON.parse(JSON.stringify(comp)) as Composition;
}

// ── scene resize ─────────────────────────────────────────────────────────────

export interface ResizeSceneOptions {
  /** Minimum scene duration in ms. Default 500. */
  min?: number;
}

/**
 * Resize a scene by setting a new duration (derived from its current startMs).
 * All subsequent scenes are shifted so they remain contiguous.
 * Returns a new deep-equal Composition when the target is out-of-range or the
 * result would be identical.
 */
export function resizeScene(
  comp: Composition,
  sceneIdx: number,
  newDurationMs: number,
  opts: ResizeSceneOptions = {},
): Composition {
  const minMs = opts.min ?? 500;
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newDurationMs)
  ) {
    return cloneComp(comp);
  }

  const clampedDuration = Math.max(minMs, newDurationMs);
  const target = comp.scenes[sceneIdx];
  const oldEndMs = target.endMs;
  const newEndMs = target.startMs + clampedDuration;

  // No-op: same effective end (within floating-point tolerance).
  if (Math.abs(newEndMs - oldEndMs) < 0.001) {
    return cloneComp(comp);
  }

  const delta = newEndMs - oldEndMs;
  const next = cloneComp(comp);

  // Apply the resize to the target scene.
  next.scenes[sceneIdx].endMs = newEndMs;

  // Shift all subsequent scenes.
  for (let i = sceneIdx + 1; i < next.scenes.length; i++) {
    next.scenes[i].startMs += delta;
    next.scenes[i].endMs += delta;
  }

  return next;
}

// ── overlay edit helpers ─────────────────────────────────────────────────────

/** Scene duration in seconds (convenience). */
function sceneDurationS(scene: CompositionScene): number {
  return (scene.endMs - scene.startMs) / 1000;
}

/**
 * Move a b-roll overlay's start time (in seconds relative to scene start),
 * clamped so start >= 0 and start + duration <= scene duration.
 * Out-of-range sceneIdx / overlayIdx returns deep-equal clone.
 */
export function moveOverlay(
  comp: Composition,
  sceneIdx: number,
  overlayIdx: number,
  newStart: number,
): Composition {
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newStart)
  ) {
    return cloneComp(comp);
  }
  const scene = comp.scenes[sceneIdx];
  const overlays = scene.overlays ?? [];
  if (overlayIdx < 0 || overlayIdx >= overlays.length) {
    return cloneComp(comp);
  }
  const ov = overlays[overlayIdx];
  const maxStart = Math.max(0, sceneDurationS(scene) - ov.duration);
  const clampedStart = Math.max(0, Math.min(maxStart, newStart));

  if (Math.abs(clampedStart - ov.start) < 0.0001) {
    return cloneComp(comp);
  }

  const next = cloneComp(comp);
  next.scenes[sceneIdx].overlays![overlayIdx].start = clampedStart;
  return next;
}

/**
 * Resize a b-roll overlay's duration (in seconds), clamped so:
 *   start >= 0, duration >= 0.1, start + duration <= scene duration.
 * Out-of-range inputs return deep-equal clone.
 */
export function resizeOverlay(
  comp: Composition,
  sceneIdx: number,
  overlayIdx: number,
  newDuration: number,
): Composition {
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newDuration)
  ) {
    return cloneComp(comp);
  }
  const scene = comp.scenes[sceneIdx];
  const overlays = scene.overlays ?? [];
  if (overlayIdx < 0 || overlayIdx >= overlays.length) {
    return cloneComp(comp);
  }
  const ov = overlays[overlayIdx];
  const maxDuration = Math.max(0.1, sceneDurationS(scene) - ov.start);
  const clampedDuration = Math.max(0.1, Math.min(maxDuration, newDuration));

  if (Math.abs(clampedDuration - ov.duration) < 0.0001) {
    return cloneComp(comp);
  }

  const next = cloneComp(comp);
  next.scenes[sceneIdx].overlays![overlayIdx].duration = clampedDuration;
  return next;
}

// ── infographic edit helpers ─────────────────────────────────────────────────

/**
 * Move an infographic's start time (seconds relative to scene start).
 * Clamped: start >= 0, start + (duration ?? rest-of-scene) <= scene duration.
 */
export function moveInfographic(
  comp: Composition,
  sceneIdx: number,
  igIdx: number,
  newStart: number,
): Composition {
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newStart)
  ) {
    return cloneComp(comp);
  }
  const scene = comp.scenes[sceneIdx];
  const igs = scene.infographics ?? [];
  if (igIdx < 0 || igIdx >= igs.length) {
    return cloneComp(comp);
  }
  const ig = igs[igIdx];
  const sceneDur = sceneDurationS(scene);
  const igDur = ig.duration ?? (sceneDur - ig.start);
  const maxStart = Math.max(0, sceneDur - igDur);
  const clampedStart = Math.max(0, Math.min(maxStart, newStart));

  if (Math.abs(clampedStart - ig.start) < 0.0001) {
    return cloneComp(comp);
  }

  const next = cloneComp(comp);
  next.scenes[sceneIdx].infographics![igIdx] = {
    ...next.scenes[sceneIdx].infographics![igIdx],
    start: clampedStart,
  } as Infographic;
  return next;
}

/**
 * Resize an infographic's duration (seconds). Clamped: duration >= 0.1,
 * start + duration <= scene duration.
 * Undefined duration means "rest of scene" — this op sets an explicit one.
 */
export function resizeInfographic(
  comp: Composition,
  sceneIdx: number,
  igIdx: number,
  newDuration: number,
): Composition {
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newDuration)
  ) {
    return cloneComp(comp);
  }
  const scene = comp.scenes[sceneIdx];
  const igs = scene.infographics ?? [];
  if (igIdx < 0 || igIdx >= igs.length) {
    return cloneComp(comp);
  }
  const ig = igs[igIdx];
  const sceneDur = sceneDurationS(scene);
  const maxDuration = Math.max(0.1, sceneDur - ig.start);
  const clampedDuration = Math.max(0.1, Math.min(maxDuration, newDuration));

  if (ig.duration !== undefined && Math.abs(clampedDuration - ig.duration) < 0.0001) {
    return cloneComp(comp);
  }

  const next = cloneComp(comp);
  next.scenes[sceneIdx].infographics![igIdx] = {
    ...next.scenes[sceneIdx].infographics![igIdx],
    duration: clampedDuration,
  } as Infographic;
  return next;
}

// ── punch-beat move ──────────────────────────────────────────────────────────

/**
 * Move a punch beat to a new time (seconds relative to scene start).
 * Clamped 0 <= beat <= scene duration. Duplicate beats are deduplicated and the
 * array is kept sorted. Out-of-range beatIdx returns deep-equal clone.
 */
export function movePunchBeat(
  comp: Composition,
  sceneIdx: number,
  beatIdx: number,
  newTime: number,
): Composition {
  if (
    sceneIdx < 0 ||
    sceneIdx >= comp.scenes.length ||
    !Number.isFinite(newTime)
  ) {
    return cloneComp(comp);
  }
  const scene = comp.scenes[sceneIdx];
  const punches = scene.punches ?? [];
  if (beatIdx < 0 || beatIdx >= punches.length) {
    return cloneComp(comp);
  }
  const sceneDur = sceneDurationS(scene);
  const clampedTime = Math.max(0, Math.min(sceneDur, newTime));

  if (Math.abs(clampedTime - punches[beatIdx]) < 0.0001) {
    return cloneComp(comp);
  }

  const next = cloneComp(comp);
  const nextPunches = [...(next.scenes[sceneIdx].punches ?? [])];
  nextPunches[beatIdx] = clampedTime;
  // Deduplicate and sort.
  next.scenes[sceneIdx].punches = [...new Set(nextPunches)].sort((a, b) => a - b);
  return next;
}
