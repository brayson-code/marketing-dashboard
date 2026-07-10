"use client";

import { useLayoutEffect, useRef } from "react";
import gsap from "gsap";

export interface MetricSplashProps {
  /** The generated metric, e.g. "20" */
  value: string;
  /** Unit / label under the number, e.g. "Hrs / Week" */
  unit: string;
  /** Fires once the reveal animation settles */
  onComplete?: () => void;
  className?: string;
}

/* Hand-authored organic splash paths (viewBox 0 0 440 440, blob centered 220,220).
   Irregular edges, no straight sides — vector-crisp, not photographic paint. */
const BLOB =
  "M220 62 C300 52 374 100 370 182 C368 222 412 236 394 272 C374 310 334 296 322 322 " +
  "C314 344 338 378 302 388 C270 396 252 362 222 370 C192 378 178 414 152 394 " +
  "C130 376 152 344 130 328 C102 308 62 322 58 280 C54 244 94 236 86 200 " +
  "C80 172 42 154 62 118 C84 80 142 106 170 82 C188 66 198 64 220 62 Z";

/* Drips hang off the bottom contour only. B and D run long enough to bleed off-screen. */
const DRIP_A = "M148 386 C145 410 137 426 142 444 C146 458 166 458 170 444 C175 426 165 410 162 386 Z";
const DRIP_B = "M208 368 C205 430 200 500 208 560 C212 588 224 588 228 560 C235 500 231 430 226 368 Z";
const DRIP_C = "M293 382 C290 412 282 438 288 462 C292 478 310 478 314 462 C320 438 310 412 307 382 Z";
const DRIP_D = "M243 372 C240 430 234 500 242 556 C246 582 258 582 262 556 C270 500 265 430 261 372 Z";

export function MetricSplash({ value, unit, onComplete, className }: MetricSplashProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const q = gsap.utils.selector(el);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const ctx = gsap.context(() => {
      const blob = q("[data-splash-blob]");
      const num = q("[data-splash-num]");
      const drips = q(".metric-drip");
      const droplets = q(".metric-droplet");

      // Initial hidden states (set pre-paint to avoid any flash of the final frame)
      gsap.set(blob, { svgOrigin: "220 220", scale: 0, opacity: 0 });
      gsap.set(num, { opacity: 0, scale: 0.8, y: 6 });
      gsap.set(drips, { transformOrigin: "50% 0%", scaleY: 0 });
      gsap.set(droplets, { opacity: 0, scale: 0 });

      if (reduce) {
        // Respect reduced motion: gentle cross-fade in, no bounce or drip growth.
        gsap.to(blob, { opacity: 1, scale: 1, duration: 0.2 });
        gsap.to(num, { opacity: 1, scale: 1, y: 0, duration: 0.2, delay: 0.05 });
        gsap.to(drips, {
          scaleY: 1,
          duration: 0.2,
          delay: 0.1,
          onComplete: () => onCompleteRef.current?.(),
        });
        return;
      }

      // Radiate-first, drip-second (~700ms). The blob is the hero.
      const dropX = [-72, 82, 58];
      const dropY = [-58, -42, 70];
      gsap
        .timeline({ onComplete: () => onCompleteRef.current?.() })
        // 1) Blob erupts from behind the number and radiates outward (squash-settle overshoot)
        .to(blob, { scale: 1, opacity: 1, duration: 0.38, ease: "back.out(1.8)" }, 0)
        // 2) Number pops in on top
        .to(num, { opacity: 1, scale: 1.05, y: 0, duration: 0.2, ease: "back.out(2)" }, 0.15)
        .to(num, { scale: 1, duration: 0.14, ease: "power2.out" }, ">-0.02")
        // 3) Accent droplets flick outward at the burst peak, then fade
        .to(droplets, { opacity: 1, scale: 1, duration: 0.1, stagger: 0.02, ease: "power1.out" }, 0.2)
        .to(
          droplets,
          {
            x: (i: number) => dropX[i] ?? 0,
            y: (i: number) => dropY[i] ?? 0,
            opacity: 0,
            scale: 0.4,
            duration: 0.42,
            ease: "power2.out",
          },
          0.28,
        )
        // 4) Drips grow down from the bottom only, gravity easing; long ones bleed off-screen
        .to(
          drips,
          {
            scaleY: 1,
            duration: (i: number) => 0.34 + i * 0.05,
            ease: "power2.in",
            stagger: 0.05,
          },
          0.3,
        );
    }, el);

    return () => ctx.revert();
    // Mount-triggered: parent controls replay by conditionally rendering / re-keying.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={rootRef}
      className={`pointer-events-none absolute inset-0 z-50 grid place-items-center ${className ?? ""}`}
      aria-live="polite"
    >
      <div className="relative" style={{ width: "min(62vmin, 440px)", aspectRatio: "1 / 1" }}>
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 440 440"
          style={{ overflow: "visible" }}
          aria-hidden="true"
        >
          <defs>
            {/* Body: vivid highlight at the edge -> brand green core */}
            <radialGradient id="splashGrad" cx="50%" cy="46%" r="66%">
              <stop offset="0%" stopColor="var(--splash-core)" />
              <stop offset="60%" stopColor="var(--splash-core)" />
              <stop offset="100%" stopColor="var(--splash-hi)" />
            </radialGradient>
            {/* Inner shadow overlay for dimension (darker toward center) */}
            <radialGradient id="splashCore" cx="50%" cy="54%" r="56%">
              <stop offset="0%" stopColor="var(--splash-shadow)" stopOpacity="0.30" />
              <stop offset="70%" stopColor="var(--splash-shadow)" stopOpacity="0" />
            </radialGradient>
            {/* Drips darken toward the tips */}
            <linearGradient id="dripGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--splash-core)" />
              <stop offset="100%" stopColor="var(--splash-shadow)" />
            </linearGradient>
          </defs>

          {/* Drips sit behind the body so their necks tuck under the splash */}
          <g data-splash-drips>
            <path className="metric-drip" d={DRIP_A} fill="url(#dripGrad)" />
            <path className="metric-drip" d={DRIP_B} fill="url(#dripGrad)" />
            <path className="metric-drip" d={DRIP_C} fill="url(#dripGrad)" />
            <path className="metric-drip" d={DRIP_D} fill="url(#dripGrad)" />
          </g>

          {/* Hero blob + inner-shadow overlay, scaled together from center */}
          <g data-splash-blob>
            <path d={BLOB} fill="url(#splashGrad)" />
            <path d={BLOB} fill="url(#splashCore)" />
          </g>

          {/* Accent droplets */}
          <g data-splash-droplets>
            <circle className="metric-droplet" cx="112" cy="132" r="7" fill="var(--splash-hi)" />
            <circle className="metric-droplet" cx="350" cy="150" r="6" fill="var(--splash-hi)" />
            <circle className="metric-droplet" cx="330" cy="336" r="8" fill="var(--splash-core)" />
          </g>
        </svg>

        {/* White knockout number, centered on the blob */}
        <div className="absolute inset-0 grid place-items-center px-6 text-center" data-splash-num>
          <div>
            <div
              style={{
                color: "#ffffff",
                fontWeight: 800,
                lineHeight: 1,
                letterSpacing: "-0.02em",
                fontSize: "clamp(2.75rem, 13vmin, 5.25rem)",
                textShadow: "0 2px 10px color-mix(in srgb, var(--splash-shadow) 45%, transparent)",
              }}
            >
              {value}
            </div>
            <div
              style={{
                color: "rgba(255,255,255,0.92)",
                fontWeight: 600,
                marginTop: "0.4rem",
                letterSpacing: "0.01em",
                fontSize: "clamp(0.9rem, 3.2vmin, 1.25rem)",
              }}
            >
              {unit}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetricSplash;
