"use client";

import { forwardRef } from "react";

/**
 * The Claude mascot is built ENTIRELY from <rect> elements (no paths / curves),
 * grouped so each body part can be transformed independently by GSAP.
 *
 * Coordinate system / geometry (viewBox 0 0 120 96) is reconstructed to match
 * the numbers published in the Codrops article:
 *   - legs: x = 11 / 32 / 64 / 85, y = 60, width 11, height 26
 *   - ground-clip rect: x -20, y -50, w 160, h 136
 *   - body transform origin (the "shoulder pivot") at svgOrigin "53 65"
 *
 * The Claude coral / orange used across the official mascot art is #DD775B.
 */

export const MASCOT_COLOR = "#DD775B";
export const MASCOT_DARK = "#C2613F";
export const MASCOT_EYE = "#1F1A17";

export interface MascotPartRefs {
  svg: SVGSVGElement | null;
  group: SVGGElement | null;
  body: SVGRectElement | null;
  eyes: SVGGElement | null;
  eyeL: SVGRectElement | null;
  eyeR: SVGRectElement | null;
  leftHand: SVGRectElement | null;
  rightHand: SVGRectElement | null;
  legs: (SVGRectElement | null)[];
}

export interface MascotArtProps {
  /** width/height in px — the SVG keeps its 120x96 aspect via viewBox */
  size?: number;
  color?: string;
  className?: string;
  /**
   * Callback giving you direct refs to every animatable part.
   * Called once on mount (refs are stable for the lifetime of the node).
   */
  onParts?: (parts: MascotPartRefs) => void;
}

/**
 * Pure presentational mascot. Exposes its inner parts through a single
 * `onParts` callback so a parent can drive them with GSAP without prop drilling
 * dozens of refs. The wrapping <svg> ref is forwarded.
 */
export const MascotArt = forwardRef<SVGSVGElement, MascotArtProps>(
  function MascotArt({ size = 220, color = MASCOT_COLOR, className, onParts }, ref) {
    // Collected mutable refs handed back through onParts.
    const parts: MascotPartRefs = {
      svg: null,
      group: null,
      body: null,
      eyes: null,
      eyeL: null,
      eyeR: null,
      leftHand: null,
      rightHand: null,
      legs: [null, null, null, null],
    };

    const flush = () => onParts?.(parts);

    return (
      <svg
        ref={(el) => {
          parts.svg = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
          flush();
        }}
        className={className}
        width={size}
        height={(size * 96) / 120}
        viewBox="0 0 120 96"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="Claude mascot"
        role="img"
      >
        <defs>
          {/* Keeps stretched legs from crossing below the ground line. */}
          <clipPath id="ground-clip">
            <rect x="-20" y="-50" width="160" height="136" />
          </clipPath>
        </defs>

        {/* The whole mascot — translated/jumped as one unit during the walk. */}
        <g
          ref={(el) => {
            parts.group = el;
            flush();
          }}
        >
          {/* Legs live inside the ground clip so scaleY stretching is masked. */}
          <g clipPath="url(#ground-clip)">
            <rect
              ref={(el) => {
                parts.legs[3] = el;
                flush();
              }}
              id="leg4"
              x="85"
              y="60"
              width="11"
              height="26"
              rx="2"
              fill={color}
            />
            <rect
              ref={(el) => {
                parts.legs[2] = el;
                flush();
              }}
              id="leg3"
              x="64"
              y="60"
              width="11"
              height="26"
              rx="2"
              fill={color}
            />
            <rect
              ref={(el) => {
                parts.legs[1] = el;
                flush();
              }}
              id="leg2"
              x="32"
              y="60"
              width="11"
              height="26"
              rx="2"
              fill={color}
            />
            <rect
              ref={(el) => {
                parts.legs[0] = el;
                flush();
              }}
              id="leg1"
              x="11"
              y="60"
              width="11"
              height="26"
              rx="2"
              fill={color}
            />
          </g>

          {/* Hands sit beside the body and drop slightly during the crouch. */}
          <rect
            ref={(el) => {
              parts.leftHand = el;
              flush();
            }}
            id="left-hand"
            x="2"
            y="44"
            width="10"
            height="22"
            rx="3"
            fill={color}
          />
          <rect
            ref={(el) => {
              parts.rightHand = el;
              flush();
            }}
            id="right-hand"
            x="95"
            y="44"
            width="10"
            height="22"
            rx="3"
            fill={color}
          />

          {/* The body block. Transform origin "53 65" matches the article. */}
          <rect
            ref={(el) => {
              parts.body = el;
              flush();
            }}
            id="body"
            x="14"
            y="18"
            width="79"
            height="48"
            rx="10"
            fill={color}
          />

          {/* Eyes group — darts left/right while "looking around". */}
          <g
            ref={(el) => {
              parts.eyes = el;
              flush();
            }}
            id="eyes"
          >
            <rect
              ref={(el) => {
                parts.eyeL = el;
                flush();
              }}
              x="38"
              y="34"
              width="8"
              height="14"
              rx="4"
              fill={MASCOT_EYE}
            />
            <rect
              ref={(el) => {
                parts.eyeR = el;
                flush();
              }}
              x="61"
              y="34"
              width="8"
              height="14"
              rx="4"
              fill={MASCOT_EYE}
            />
          </g>
        </g>
      </svg>
    );
  }
);
