"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useInjectedSvg } from "./use-injected-svg";

/**
 * FrameSvg — the article's sprite-FRAME engine, driven by REAL injected SVGs.
 *
 * Several of Claude's mascot animations ship as a single SVG file containing
 * many "frame" <g> groups stacked on top of each other, where exactly one is
 * visible at a time (`display:inline`) and the rest are `display:none`. Playing
 * the animation = walking a GSAP timeline that flips which group is `inline`,
 * advancing a `time` cursor by a per-frame hold value.
 *
 * This component:
 *   1. Injects the real SVG (runtime fetch -> innerHTML) via useInjectedSvg.
 *   2. Detects the frame groups using a caller-supplied `selectFrames` fn (each
 *      asset structures its frames differently — see the per-animation wrappers
 *      and README for how the groups were identified).
 *   3. Builds a single looping timeline (`repeat: -1`) of
 *      `tl.set(group, { display })` toggles with variable per-frame timing.
 *
 * Cleanup uses gsap.context().revert() + tl.kill() on unmount / src change.
 */

export interface FrameSvgProps {
  /** Path under /public, e.g. "/sprites/claude-gym.svg". */
  src: string;
  /**
   * Given the injected <svg>, return the ordered list of frame <g> groups.
   * Returning them in document/play order is the caller's responsibility.
   */
  selectFrames: (svg: SVGSVGElement) => SVGGElement[];
  /**
   * Per-frame hold time in seconds. Receives (playIndex, frameIndex) where
   * playIndex is the position in `sequence` and frameIndex is the frame's index
   * in the array returned by selectFrames. Defaults to a constant 0.085s.
   */
  getDelay?: (playIndex: number, frameIndex: number) => number;
  /**
   * Optional explicit play order over the detected frames (indices into the
   * selectFrames array). Lets an animation repeat frames (e.g. a second rep).
   * Defaults to each frame once, in order.
   */
  sequence?: (frameCount: number) => number[];
  /**
   * Optional hook to attach extra tweens to the master timeline AFTER the frame
   * toggles are wired (e.g. confetti bursts, hand sway). Receives the timeline,
   * the injected svg, the detected frames, and the per-frame `times[]` cursor so
   * extras can be phase-aligned to specific frames.
   */
  buildExtra?: (
    tl: gsap.core.Timeline,
    ctx: { svg: SVGSVGElement; frames: SVGGElement[]; times: number[] }
  ) => void;
  size?: number;
  className?: string;
  playing?: boolean;
  /** Called once the master timeline is built (for external control). */
  onTimeline?: (tl: gsap.core.Timeline) => void;
  "aria-label"?: string;
}

const DEFAULT_DELAY = 0.14;

export function FrameSvg({
  src,
  selectFrames,
  getDelay,
  sequence,
  buildExtra,
  size = 220,
  className,
  playing = true,
  onTimeline,
  "aria-label": ariaLabel = "Claude mascot animation",
}: FrameSvgProps) {
  const { hostRef, svg } = useInjectedSvg(src);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  // Build (and rebuild on src/svg change) the frame-cycling timeline.
  useEffect(() => {
    if (!svg) return;

    const frames = selectFrames(svg);
    if (frames.length === 0) return;

    const ctx = gsap.context(() => {
      // Start from a known state: hide every frame.
      frames.forEach((g) => gsap.set(g, { display: "none" }));

      const delayFn = getDelay ?? (() => DEFAULT_DELAY);
      const order = sequence
        ? sequence(frames.length)
        : frames.map((_, i) => i);

      const tl = gsap.timeline({ repeat: -1 });
      tlRef.current = tl;

      const times: number[] = [];
      let time = 0;
      for (let i = 0; i < order.length; i++) {
        const frameIdx = order[i];
        times.push(time);
        // Show exactly the active frame, hide the others at this beat.
        frames.forEach((g, j) => {
          tl.set(g, { display: j === frameIdx ? "inline" : "none" }, time);
        });
        time += delayFn(i, frameIdx);
      }

      if (buildExtra) buildExtra(tl, { svg, frames, times });
      if (onTimeline) onTimeline(tl);
      if (!playing) tl.pause();
    }, hostRef);

    return () => {
      tlRef.current?.kill();
      tlRef.current = null;
      ctx.revert();
    };
    // Rebuild whenever the injected svg instance changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

  // Respond to play/pause without rebuilding the timeline.
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (playing) tl.play();
    else tl.pause();
  }, [playing]);

  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: size, height: size, lineHeight: 0 }}
      role="img"
      aria-label={ariaLabel}
    />
  );
}

/**
 * Frame-group detectors for the real assets.
 *
 * gym + flag: the only <g> elements carrying an explicit inline `display`
 * (style or attribute) ARE the frames — exactly one starts `inline`, the rest
 * `none`. querySelectorAll returns them in document order, which is play order.
 *
 * confetti: frames are explicitly id'd `l001`..`l00N`, so we select by id
 * prefix (the file also contains nested decorative particle <g>s that DO carry
 * display, so an id-based selector is the safe choice here).
 */
export const frameSelectors = {
  /** Any <g> with an explicit display style/attr, in document order. */
  byDisplayStyle: (svg: SVGSVGElement): SVGGElement[] =>
    Array.from(svg.querySelectorAll<SVGGElement>("g")).filter((g) => {
      const styleDisplay = g.style.display; // reads inline style="display:..."
      const attrDisplay = g.getAttribute("display");
      return (
        styleDisplay === "none" ||
        styleDisplay === "inline" ||
        attrDisplay === "none" ||
        attrDisplay === "inline"
      );
    }),

  /** Groups whose id matches the given prefix (e.g. "l0" -> l001..l008). */
  byIdPrefix:
    (prefix: string) =>
    (svg: SVGSVGElement): SVGGElement[] =>
      Array.from(svg.querySelectorAll<SVGGElement>(`g[id^="${prefix}"]`)),
};
