"use client";

import type { gsap } from "gsap";
import { FrameSvg, frameSelectors } from "./frame-svg";

export interface ConfettiClaudeProps {
  size?: number;
  className?: string;
  playing?: boolean;
  onTimeline?: (tl: gsap.core.Timeline) => void;
}

/**
 * ConfettiClaude — the stomping mascot that fires confetti, driven by the REAL
 * public/sprites/claude-confetti.svg (viewBox 0 0 129 113).
 *
 * Frame detection: the 8 stomp/confetti frames are explicitly id'd
 * `l001`..`l008` at the top level, so we select them with
 * `frameSelectors.byIdPrefix("l0")`. (An id-based selector is used here rather
 * than the display-style detector because each frame also nests decorative
 * confetti-particle <g>s that themselves carry `display`, which would otherwise
 * be picked up as false frames.)
 *
 * The confetti bursts + stomp are baked into the 8 frames, so this is pure
 * frame-cycling at a steady ~0.085s beat — no synthesised particle overlay.
 */

const FRAME_DURATION = 0.16;

export function ConfettiClaude({
  size = 220,
  className,
  playing = true,
  onTimeline,
}: ConfettiClaudeProps) {
  return (
    <FrameSvg
      src="/sprites/claude-confetti.svg"
      selectFrames={frameSelectors.byIdPrefix("l0")}
      getDelay={() => FRAME_DURATION}
      size={size}
      className={className}
      playing={playing}
      onTimeline={onTimeline}
      aria-label="Claude stomping with confetti"
    />
  );
}
