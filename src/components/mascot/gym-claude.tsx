"use client";

import { SpriteClaude } from "./sprite-claude";

export interface GymClaudeProps {
  /** 36 frame URLs from public/sprites/gym/ */
  frameSrcs?: string[];
  size?: number;
  className?: string;
  playing?: boolean;
}

/**
 * GymClaude — the weightlifting sprite animation.
 *
 * Article spec: 36 illustrated frames played as 48 beats, with frames 13–24
 * repeated for a second rep. Variable per-frame hold times via getDelay:
 *   - 0.085s default
 *   - 0.27s at frames 6 and 7 (the strain at the top of the lift)
 *   - 0.4s at frames 15 and 21 (held reps)
 *   - 1.5s on the very last beat (rest before looping)
 */

// 0..35 once, then 13..24 again => 36 frames across 48 beats.
const GYM_SEQUENCE: number[] = [
  ...Array.from({ length: 36 }, (_, i) => i),
  ...Array.from({ length: 12 }, (_, i) => 13 + i),
];

function gymDelay(seqIdx: number, frame: number): number {
  if (seqIdx === GYM_SEQUENCE.length - 1) return 1.5;
  if (frame === 6 || frame === 7) return 0.27;
  if (frame === 15) return 0.4;
  if (frame === 21) return 0.4;
  return 0.085;
}

export function GymClaude({ frameSrcs, size = 240, className, playing = true }: GymClaudeProps) {
  return (
    <SpriteClaude
      frameSrcs={frameSrcs}
      frameSequence={GYM_SEQUENCE}
      getDelay={gymDelay}
      size={size}
      className={className}
      playing={playing}
      placeholderLabel="GymClaude (lifting)"
      expectedFrames={36}
    />
  );
}
