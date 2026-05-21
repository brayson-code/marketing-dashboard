"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { SpriteClaude } from "./sprite-claude";

export interface FlagWaverProps {
  /** 12 frame URLs from public/sprites/flag/ (the flag-wave body loop). */
  frameSrcs?: string[];
  size?: number;
  className?: string;
  playing?: boolean;
}

/**
 * FlagWaver — the mascot waving a flag.
 *
 * Article spec: the body plays a sprite loop while a grouped hand+flag <g> is
 * offset per-frame. Two offset tables drive it:
 *   - handExtraX  : the waving hand's horizontal offset per frame
 *   - swayX       : the body sway per frame
 * Both are applied with `tl.set(handGroup, { x }, time)` aligned to the same
 * per-frame `time` cursor as the body frames.
 */

const FRAME_DURATION = 0.09;
const HAND_EXTRA_X = [0, -6, -12, -14, -8, -2, 0, 0, -4, -10, -16, -18];
const SWAY_X = [0, 0, -5, -5, 0, 4, 4, 4, 0, 0, -5, -5];

export function FlagWaver({ frameSrcs, size = 240, className, playing = true }: FlagWaverProps) {
  const handGroupRef = useRef<SVGGElement>(null);
  const bodyGroupRef = useRef<SVGGElement>(null);

  // The hand + flag travel together inside one <g>; the body sways in another.
  const overlay = (
    <>
      <g ref={bodyGroupRef} data-layer="body-sway" />
      <g ref={handGroupRef} data-layer="hand-flag">
        {/* Placeholder flag pole + cloth drawn from rects (replaced visually by
            the sprite frames once art is supplied; kept for framework demo). */}
        <rect x="150" y="70" width="4" height="70" rx="2" fill="#8a7a70" opacity="0.0" />
      </g>
    </>
  );

  const buildExtra = (tl: gsap.core.Timeline) => {
    const hand = handGroupRef.current;
    const body = bodyGroupRef.current;
    if (!hand || !body) return;

    // Re-walk the same time cursor the engine used (FRAME_DURATION per beat) and
    // set the grouped hand+flag x offset + body sway per frame.
    let time = 0;
    for (let frame = 0; frame < HAND_EXTRA_X.length; frame++) {
      tl.set(hand, { x: HAND_EXTRA_X[frame] }, time);
      tl.set(body, { x: SWAY_X[frame] }, time);
      time += FRAME_DURATION;
    }
  };

  return (
    <SpriteClaude
      frameSrcs={frameSrcs}
      getDelay={() => FRAME_DURATION}
      size={size}
      className={className}
      playing={playing}
      placeholderLabel="FlagWaver (waving)"
      expectedFrames={12}
      overlay={overlay}
      buildExtra={buildExtra}
    />
  );
}
