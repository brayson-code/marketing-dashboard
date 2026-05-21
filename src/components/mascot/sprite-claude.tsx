"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

/**
 * SpriteClaude — the generic sprite-frame engine described in the article.
 *
 * Each animation is a stack of <image> frames laid on top of each other; only
 * ONE is visible at a time. The article toggles them with
 * `gsap.set(el, { display })` on a timeline, advancing `time` by a per-frame
 * hold value pulled from a `getDelay()` table. We drive the frames from a
 * `frames` ref array exactly as described.
 *
 * No frame art is shipped yet, so when `frameSrcs` is empty/absent we render a
 * labelled placeholder. Drop PNGs into public/sprites/<anim>/ and pass their
 * paths as `frameSrcs` to light it up.
 */

export interface SpriteClaudeProps {
  /** Ordered list of frame image URLs, e.g. ["/sprites/gym/01.png", ...]. */
  frameSrcs?: string[];
  /**
   * Playback order over the available frames. Lets you repeat frames (e.g. the
   * gym anim plays 36 frames across 48 beats by repeating frames 13–24). If
   * omitted, plays each frame once in order.
   */
  frameSequence?: number[];
  /**
   * Per-beat hold time in seconds. Receives (sequenceIndex, frameIndex).
   * Defaults to a constant 0.085s — override per animation.
   */
  getDelay?: (seqIdx: number, frame: number) => number;
  /** viewBox width/height for the sprite canvas. */
  viewWidth?: number;
  viewHeight?: number;
  size?: number;
  className?: string;
  playing?: boolean;
  /** Label shown on the placeholder when no frame art is present. */
  placeholderLabel?: string;
  /** Expected frame count, surfaced on the placeholder for documentation. */
  expectedFrames?: number;
  /**
   * Optional decorator rendered INSIDE the same <svg> as extra <g> layers
   * (used by Flag/Confetti for hand groups, particle bursts, etc). Receives
   * the svg root ref scope so children can be GSAP-targeted by id/data attrs.
   */
  overlay?: React.ReactNode;
  /** Called after the master timeline is built (for external play/pause). */
  onTimeline?: (tl: gsap.core.Timeline) => void;
  /**
   * Hook to attach extra tweens to the timeline (hands, sway, confetti).
   * Runs inside the gsap.context, after frames are wired.
   */
  buildExtra?: (tl: gsap.core.Timeline, ctx: { root: SVGSVGElement }) => void;
}

const DEFAULT_DELAY = 0.085;

export function SpriteClaude({
  frameSrcs,
  frameSequence,
  getDelay,
  viewWidth = 240,
  viewHeight = 240,
  size = 240,
  className,
  playing = true,
  placeholderLabel = "Sprite frames not loaded",
  expectedFrames,
  overlay,
  onTimeline,
  buildExtra,
}: SpriteClaudeProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<SVGSVGElement>(null);
  const frames = useRef<(SVGImageElement | null)[]>([]);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  const hasArt = !!frameSrcs && frameSrcs.length > 0;

  useEffect(() => {
    if (!hasArt) return;
    const root = rootRef.current;
    if (!root) return;

    const ctx = gsap.context(() => {
      const seq = frameSequence ?? frameSrcs!.map((_, i) => i);
      const delayFn = getDelay ?? (() => DEFAULT_DELAY);

      const tl = gsap.timeline({ repeat: -1 });
      tlRef.current = tl;

      // Wire the frame toggles exactly as the article does.
      let time = 0;
      for (let i = 0; i < seq.length; i++) {
        const frame = seq[i];
        frames.current.forEach((el, j) => {
          if (el) tl.set(el, { display: j === frame ? "inline" : "none" }, time);
        });
        time += delayFn(i, frame);
      }

      if (buildExtra) buildExtra(tl, { root });
      if (onTimeline) onTimeline(tl);
      if (!playing) tl.pause();
    }, scopeRef);

    return () => {
      ctx.revert();
      tlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasArt]);

  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (playing) tl.play();
    else tl.pause();
  }, [playing]);

  if (!hasArt) {
    return (
      <div
        ref={scopeRef}
        className={className}
        style={{
          width: size,
          height: (size * viewHeight) / viewWidth,
          display: "grid",
          placeItems: "center",
          border: "2px dashed var(--border, #d4c4ba)",
          borderRadius: 12,
          color: "var(--muted-foreground, #8a7a70)",
          background:
            "repeating-linear-gradient(45deg, transparent, transparent 8px, rgba(221,119,91,0.06) 8px, rgba(221,119,91,0.06) 16px)",
          textAlign: "center",
          fontSize: 12,
          padding: 8,
          boxSizing: "border-box",
        }}
        aria-label={placeholderLabel}
      >
        <div>
          <strong style={{ display: "block", color: "#DD775B" }}>{placeholderLabel}</strong>
          {expectedFrames ? (
            <span>
              Drop {expectedFrames} frames — see
              <br />
              src/components/mascot/README.md
            </span>
          ) : (
            <span>Provide frameSrcs to play</span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={scopeRef} className={className} style={{ lineHeight: 0 }}>
      <svg
        ref={rootRef}
        width={size}
        height={(size * viewHeight) / viewWidth}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label={placeholderLabel}
        role="img"
      >
        {frameSrcs!.map((src, i) => (
          <image
            key={src + i}
            ref={(el) => {
              frames.current[i] = el;
            }}
            href={src}
            x="0"
            y="0"
            width={viewWidth}
            height={viewHeight}
            style={{ display: i === 0 ? "inline" : "none" }}
            preserveAspectRatio="xMidYMid meet"
          />
        ))}
        {overlay}
      </svg>
    </div>
  );
}
