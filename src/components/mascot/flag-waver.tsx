"use client";

import type { gsap } from "gsap";
import { FrameSvg, frameSelectors } from "./frame-svg";

export interface FlagWaverProps {
  size?: number;
  className?: string;
  playing?: boolean;
  onTimeline?: (tl: gsap.core.Timeline) => void;
}

/**
 * FlagWaver — the mascot waving a flag, driven by the REAL
 * public/sprites/claude-flag-waver.svg (viewBox 0 0 158 128).
 *
 * Frame detection: the file is a flat list of 36 top-level <g> siblings, each
 * an illustrated frame with the body + waving-hand + flag baked in. Exactly one
 * starts `display:inline` (frame index 22) and the other 35 are `display:none`,
 * and these 36 are the ONLY <g> with explicit display in the file — so
 * `frameSelectors.byDisplayStyle` returns all 36 frames in document order.
 *
 * Because the hand sway + flag cloth are already drawn into each frame, the
 * animation is pure frame-cycling — no overlay tweens needed (unlike the earlier
 * placeholder version that synthesised hand offsets). ~0.09s per frame gives the
 * loose flag-wave cadence from the article.
 */

const FRAME_DURATION = 0.09;

export function FlagWaver({ size = 220, className, playing = true, onTimeline }: FlagWaverProps) {
  return (
    <FrameSvg
      src="/sprites/claude-flag-waver.svg"
      selectFrames={frameSelectors.byDisplayStyle}
      getDelay={() => FRAME_DURATION}
      size={size}
      className={className}
      playing={playing}
      onTimeline={onTimeline}
      aria-label="Claude waving a flag"
    />
  );
}
