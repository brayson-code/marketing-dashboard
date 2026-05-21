"use client";

import { useRef } from "react";
import { gsap } from "gsap";
import { SpriteClaude } from "./sprite-claude";
import { MASCOT_COLOR } from "./mascot-art";

export interface ConfettiClaudeProps {
  /** 8 frame URLs from public/sprites/stomp/ (the stomping body loop). */
  frameSrcs?: string[];
  size?: number;
  className?: string;
  playing?: boolean;
}

/**
 * ConfettiClaude — the stomping mascot that fires two confetti bursts.
 *
 * Article spec:
 *   - The body cycles through stomp frames (the array drives the SpriteClaude
 *     engine). FRAME_DURATION is the per-frame beat used to phase the bursts.
 *   - Two confetti bursts run on INDEPENDENT timelines synchronised purely by
 *     `delay`: the first at +1 frame, the second at +6 frames.
 *   - Each particle rises through the Y-offset arc
 *       [-65, -72, -76, -70, -58, -42, -22, 0]
 *     (peak then fall back to 0).
 *   - The second burst is the first mirrored with scale(-1, 1).
 */

const FRAME_DURATION = 0.085;
const PARTICLE_Y_OFFSETS = [-65, -72, -76, -70, -58, -42, -22, 0];
const PARTICLE_X_SPREAD = [0, 14, -10, 22, -18, 30, -26, 8];

export function ConfettiClaude({
  frameSrcs,
  size = 240,
  className,
  playing = true,
}: ConfettiClaudeProps) {
  const burstARef = useRef<SVGGElement>(null);
  const burstBRef = useRef<SVGGElement>(null);

  // Build the confetti as an overlay layered into the sprite's <svg>.
  const overlay = (
    <>
      <g ref={burstARef} data-burst="a" transform="translate(120 150)" />
      {/* Mirrored second burst */}
      <g ref={burstBRef} data-burst="b" transform="translate(120 150) scale(-1, 1)" />
    </>
  );

  const buildExtra = (tl: gsap.core.Timeline) => {
    // Populate each burst group with particle rects, then animate them on their
    // own independent (delayed) timelines so they read as synchronized bursts.
    const colors = [MASCOT_COLOR, "#E8B04B", "#5A8FD6", "#6CC18E", "#C2613F"];

    [burstARef.current, burstBRef.current].forEach((host, burstIdx) => {
      if (!host) return;
      // create particles once
      host.innerHTML = "";
      PARTICLE_Y_OFFSETS.forEach((_, p) => {
        const r = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        r.setAttribute("width", "7");
        r.setAttribute("height", "7");
        r.setAttribute("rx", "1.5");
        r.setAttribute("fill", colors[p % colors.length]);
        r.setAttribute("x", "-3.5");
        r.setAttribute("y", "-3.5");
        host.appendChild(r);
      });

      const particles = Array.from(host.children) as SVGRectElement[];
      const burstTl = gsap.timeline({
        repeat: -1,
        delay: (burstIdx === 0 ? 1 : 6) * FRAME_DURATION,
      });

      particles.forEach((particle, p) => {
        const peak = PARTICLE_Y_OFFSETS[p];
        burstTl
          .fromTo(
            particle,
            { y: 0, x: 0, opacity: 1, rotation: 0, scale: 1 },
            {
              y: peak,
              x: PARTICLE_X_SPREAD[p],
              rotation: p % 2 ? 180 : -180,
              duration: 0.32,
              ease: "power2.out",
            },
            0
          )
          .to(
            particle,
            {
              y: 30,
              x: PARTICLE_X_SPREAD[p] * 1.6,
              opacity: 0,
              rotation: p % 2 ? 360 : -360,
              duration: 0.42,
              ease: "power2.in",
            },
            0.32
          );
      });

      // Nest the independent burst into the master so play/pause cascades.
      tl.add(burstTl, 0);
    });
  };

  return (
    <SpriteClaude
      frameSrcs={frameSrcs}
      getDelay={() => FRAME_DURATION}
      size={size}
      className={className}
      playing={playing}
      placeholderLabel="ConfettiClaude (stomping)"
      expectedFrames={8}
      overlay={overlay}
      buildExtra={buildExtra}
    />
  );
}
