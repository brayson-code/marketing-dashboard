"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { MASCOT_COLOR, MASCOT_EYE } from "./colors";

export interface MascotDanceProps {
  /** Rendered height in px. Designed to look crisp at 24–34px. Default 30. */
  size?: number;
  color?: string;
  className?: string;
  /** Pause/resume the idle loop. */
  playing?: boolean;
}

/**
 * MascotDance — a tiny, self-contained looping idle.
 *
 * Built to "ride" the fill edge of a horizontal progress bar, so it is its OWN
 * miniature <rect>-only mascot (synthetic, NOT one of the real sprite SVGs)
 * tuned to stay crisp at ~24–34px: thicker strokes-as-fills, generous radii, a small
 * viewBox (0 0 32 34) for pixel-snapping.
 *
 * Pure GSAP. The loop combines:
 *   - a vertical BOB on the whole group (sine.inOut, yoyo)
 *   - a body WIGGLE (rotation, offset phase)
 *   - SQUASH / STRETCH on the body (scaleX/scaleY conserve volume)
 *   - alternating little FEET taps
 *   - eye blink-ish darts on a slower cadence
 */
export function MascotDance({
  size = 30,
  color = MASCOT_COLOR,
  className,
  playing = true,
}: MascotDanceProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const bodyRef = useRef<SVGRectElement>(null);
  const eyesRef = useRef<SVGGElement>(null);
  const footLRef = useRef<SVGRectElement>(null);
  const footRRef = useRef<SVGRectElement>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const group = groupRef.current;
      const body = bodyRef.current;
      const eyes = eyesRef.current;
      const footL = footLRef.current;
      const footR = footRRef.current;
      if (!group || !body || !eyes || !footL || !footR) return;

      // Body squashes from its base (bottom-center) so it grounds nicely.
      gsap.set(body, { svgOrigin: "16 24", transformOrigin: "center bottom" });

      const tl = gsap.timeline({ repeat: -1 });
      tlRef.current = tl;

      // BOB — the heartbeat of the loop. Everything else is phased off this.
      tl.to(group, { y: -3, duration: 0.34, ease: "sine.inOut", yoyo: true, repeat: -1 }, 0);

      // SQUASH / STRETCH — volume-conserving, slightly faster than the bob.
      tl.to(
        body,
        { scaleY: 1.12, scaleX: 0.92, duration: 0.34, ease: "sine.inOut", yoyo: true, repeat: -1 },
        0
      );

      // WIGGLE — gentle body rock, offset a quarter phase for life.
      tl.to(
        body,
        { rotation: 6, svgOrigin: "16 24", duration: 0.68, ease: "sine.inOut", yoyo: true, repeat: -1 },
        0.17
      );

      // FEET taps — alternate left/right.
      tl.to(footL, { y: -2, duration: 0.34, ease: "sine.inOut", yoyo: true, repeat: -1 }, 0)
        .to(footR, { y: -2, duration: 0.34, ease: "sine.inOut", yoyo: true, repeat: -1 }, 0.34);

      // EYES — slow side-to-side dart, much slower cadence than the bob.
      tl.to(eyes, { x: 1.4, duration: 1.1, ease: "sine.inOut", yoyo: true, repeat: -1 }, 0.4);

      if (!playing) tl.pause();
    }, scopeRef);

    return () => {
      ctx.revert();
      tlRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Respond to play/pause without rebuilding the timeline.
  useEffect(() => {
    const tl = tlRef.current;
    if (!tl) return;
    if (playing) tl.play();
    else tl.pause();
  }, [playing]);

  return (
    <div
      ref={scopeRef}
      className={className}
      style={{ width: (size * 32) / 34, height: size, lineHeight: 0 }}
    >
      <svg
        width={(size * 32) / 34}
        height={size}
        viewBox="0 0 32 34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        shapeRendering="geometricPrecision"
      >
        <g ref={groupRef}>
          {/* feet */}
          <rect ref={footLRef} x="9" y="26" width="5" height="6" rx="2" fill={color} />
          <rect ref={footRRef} x="18" y="26" width="5" height="6" rx="2" fill={color} />
          {/* body */}
          <rect ref={bodyRef} x="6" y="6" width="20" height="20" rx="6" fill={color} />
          {/* eyes */}
          <g ref={eyesRef}>
            <rect x="12" y="13" width="3" height="6" rx="1.5" fill={MASCOT_EYE} />
            <rect x="18" y="13" width="3" height="6" rx="1.5" fill={MASCOT_EYE} />
          </g>
        </g>
      </svg>
    </div>
  );
}
