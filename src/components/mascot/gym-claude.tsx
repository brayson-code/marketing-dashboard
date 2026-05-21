"use client";

import type { gsap } from "gsap";
import { FrameSvg, frameSelectors } from "./frame-svg";

export interface GymClaudeProps {
  size?: number;
  className?: string;
  playing?: boolean;
  onTimeline?: (tl: gsap.core.Timeline) => void;
}

/**
 * GymClaude — the weightlifting mascot, driven by the REAL
 * public/sprites/claude-gym.svg (viewBox 0 0 140 146).
 *
 * Frame detection: the file is one outer transform <g> wrapping the static base
 * (feet shadows + a leaning sub-rig) plus 12 nested frame <g> groups. Those 12
 * are the ONLY <g> elements that carry an explicit inline `display` (11 `none`
 * + 1 `inline`), so `frameSelectors.byDisplayStyle` returns exactly the lift
 * frames in document order. (Verified by walking the SVG: depth-2 = 12 groups,
 * all with display; no other depth carries display.)
 *
 * Timing: the article describes variable per-frame holds — strain holds at the
 * top of the lift and a long rest before looping. The published article worked
 * a 36-frame asset (frames 6/7 = 0.27s, 15/21 = 0.4s, last beat = 1.5s); the
 * real shipped asset is 12 frames, so we map that intent onto the actual frames:
 * a default 0.085s beat, slightly longer holds around the apex of the lift, and
 * a 1.5s rest on the final frame before the loop repeats.
 */

const DEFAULT_DELAY = 0.14;
const APEX_HOLD = 0.42; // strain at the top of the lift
const REST_HOLD = 1.8; // pause before looping

function gymDelay(playIndex: number, frameIndex: number, frameCount: number) {
  if (playIndex === frameCount - 1) return REST_HOLD;
  // Hold near the apex of the lift (the middle frames read as the strain).
  const apex = Math.floor(frameCount / 2);
  if (frameIndex === apex || frameIndex === apex - 1) return APEX_HOLD;
  return DEFAULT_DELAY;
}

export function GymClaude({ size = 220, className, playing = true, onTimeline }: GymClaudeProps) {
  return (
    <FrameSvg
      src="/sprites/claude-gym.svg"
      selectFrames={frameSelectors.byDisplayStyle}
      // frameCount is the number of detected frames; closure captures it via sequence length.
      getDelay={(playIndex, frameIndex) => gymDelay(playIndex, frameIndex, 12)}
      size={size}
      className={className}
      playing={playing}
      onTimeline={onTimeline}
      aria-label="Claude lifting weights"
    />
  );
}
