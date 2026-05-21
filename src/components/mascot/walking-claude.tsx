"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { useInjectedSvg } from "./use-injected-svg";

export interface WalkingClaudeProps {
  size?: number;
  className?: string;
  /** How far (in viewBox px, applied to the wrapping <g>) Claude leaps. */
  jumpDist?: number;
  /** Set false to mount paused; use onTimeline for external control. */
  autoPlay?: boolean;
  /** Receives the master timeline once built, e.g. for external play/pause. */
  onTimeline?: (tl: gsap.core.Timeline) => void;
}

/**
 * WalkingClaude — the TWEENED hero walk, driven by the REAL
 * public/sprites/claude-walking.svg (viewBox 0 0 107 86).
 *
 * The asset is a SINGLE <rect>-based mascot rig with the article's exact ids and
 * baked-in `data-svg-origin`:
 *   - outer  : <g id="Group 2">         (the unit that jumps/walks across)
 *   - clip   : <clipPath id="ground-clip">
 *   - legs   : #leg1 #leg2 #leg3 #leg4  (x=11/32/64/85, y=60, h=26 -> feet y=86)
 *   - body   : <g id="body"> wrapping #bdy + #left-hand + #right-hand + eyes
 *   - hands  : #left-hand #right-hand
 *   - eyes   : the inner <g> wrapping #left-eyes + #right-eyes
 *
 * We inject the SVG at runtime, query those nodes, normalize the authored
 * mid-animation transform on the outer group to identity, then run the article's
 * GSAP timeline against the REAL nodes:
 *
 *   Lean   — eyes + body + legs together via the "<" position param, 0.4s
 *            power2.out; body rotation -3 svgOrigin "53 65"; legs per-element
 *            rotation [-7,-8,-8,-9] & scaleY [1.35,1.3,1.2,1.15]. A .call() swaps
 *            each leg's svgOrigin from the HIP (y=60) to the FEET (y=86) so the
 *            walk pivots correctly, then swaps back.
 *   Crouch — body y +8 (0.1s power3.in) with hands dropping in parallel.
 *   Jump   — horizontal 0.85s power1.inOut; ascent to -90 over 0.42s sine.out;
 *            descent over 0.2s power3.in at jump+=0.6; tiny hand overshoot 0.05s.
 *   then walk across, look down, crouch + leap back, reset. Loops forever.
 */
export function WalkingClaude({
  size = 240,
  className,
  jumpDist = 60,
  autoPlay = true,
  onTimeline,
}: WalkingClaudeProps) {
  const { hostRef, svg } = useInjectedSvg("/sprites/claude-walking.svg");
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    if (!svg) return;

    const group = svg.querySelector<SVGGElement>("#Group\\ 2, [id='Group 2']");
    const body = svg.querySelector<SVGGElement>("#body");
    // The eyes live in the inner <g> that wraps #left-eyes + #right-eyes.
    const leftEye = svg.querySelector<SVGRectElement>("#left-eyes");
    const eyes = leftEye?.parentElement as SVGGElement | null;
    const leftHand = svg.querySelector<SVGRectElement>("#left-hand");
    const rightHand = svg.querySelector<SVGRectElement>("#right-hand");
    const legs = [1, 2, 3, 4]
      .map((n) => svg.querySelector<SVGRectElement>(`#leg${n}`))
      .filter(Boolean) as SVGRectElement[];

    if (!group || !body || !eyes || !leftHand || !rightHand || legs.length < 4) return;
    const hands = [leftHand, rightHand];

    const ctx = gsap.context(() => {
      // The asset is exported mid-animation: the outer group + body + hands +
      // legs carry baked `transform="matrix(...)"` (translate/rotate). Strip
      // those so the rig sits at its neutral base coords (within the 107x86
      // viewBox) and the loop starts from a clean resting pose.
      gsap.set([group, body, eyes, ...hands, ...legs], { clearProps: "transform" });

      // Leg pivots. Hips = top of rect (y=60); feet = bottom (y=86).
      const hipOrigin = (l: SVGRectElement) =>
        `${l.x.baseVal.value + l.width.baseVal.value / 2} 60`;
      const footOrigin = (l: SVGRectElement) =>
        `${l.x.baseVal.value + l.width.baseVal.value / 2} 86`;

      // Establish the lean origin = feet, so stretched legs anchor to the floor.
      legs.forEach((l) => gsap.set(l, { svgOrigin: footOrigin(l) }));

      const tl = gsap.timeline({ repeat: -1, repeatDelay: 0.4 });
      tlRef.current = tl;

      // ---- 1. Look around (eye darts) -------------------------------------
      tl.to(eyes, { x: 4, duration: 0.35, ease: "power2.out" })
        .to(eyes, { x: -4, duration: 0.45, ease: "power2.inOut" }, "+=0.25")
        .to(eyes, { x: 0, duration: 0.3, ease: "power2.inOut" }, "+=0.2");

      // ---- 2. The Lean (eyes + body + legs simultaneously via "<") --------
      tl.addLabel("lean")
        .to(eyes, { x: -3, duration: 0.4, ease: "power2.out" }, "lean")
        .to(
          body,
          {
            rotation: -3,
            x: -3,
            y: -5,
            svgOrigin: "53 65",
            duration: 0.4,
            ease: "power2.out",
          },
          "<"
        )
        .to(
          legs,
          {
            rotation: (i: number) => [-7, -8, -8, -9][i],
            scaleY: (i: number) => [1.35, 1.3, 1.2, 1.15][i],
            duration: 0.4,
            ease: "power2.out",
          },
          "<"
        );

      // ---- 3. The Crouch (body dips, hands drop in parallel) --------------
      tl.addLabel("crouch")
        .to(body, { y: 8, duration: 0.1, ease: "power3.in" }, "crouch")
        .to(hands, { y: 10, duration: 0.1, ease: "power3.in" }, "<");

      // Reset leg stretch right before the jump so they read as "tucked".
      tl.to(legs, { scaleY: 1, rotation: 0, duration: 0.12, ease: "power1.out" }, ">-0.02");

      // ---- 4. The Jump (parabolic arc via labels + relative offsets) ------
      tl.addLabel("jump")
        .to(group, { x: "+=" + jumpDist, duration: 0.85, ease: "power1.inOut" }, "jump")
        .to(body, { y: -5, rotation: 0, duration: 0.42, ease: "sine.out" }, "jump")
        .to(eyes, { x: 0, y: -3, duration: 0.42, ease: "sine.out" }, "jump")
        .to(group, { y: -90, duration: 0.42, ease: "sine.out" }, "jump")
        .to(hands, { y: -6, duration: 0.42, ease: "sine.out" }, "jump")
        .to(group, { y: 0, duration: 0.2, ease: "power3.in" }, "jump+=0.6")
        .to(hands, { y: 6, duration: 0.05, ease: "power2.in" }, "jump+=0.8")
        .to(eyes, { y: 0, duration: 0.05 }, "jump+=0.8")
        .to(hands, { y: 0, duration: 0.18, ease: "elastic.out(1, 0.5)" }, ">");

      // ---- 5. Switch leg pivot to the HIP, then walk across ---------------
      tl.call(() => {
        legs.forEach((l) => gsap.set(l, { svgOrigin: hipOrigin(l) }));
      });

      tl.addLabel("walk");
      tl.to(
        [legs[0], legs[2]],
        { rotation: 14, duration: 0.18, yoyo: true, repeat: 5, ease: "sine.inOut" },
        "walk"
      )
        .to(
          [legs[1], legs[3]],
          { rotation: -14, duration: 0.18, yoyo: true, repeat: 5, ease: "sine.inOut" },
          "walk"
        )
        .to(body, { y: -2, duration: 0.18, yoyo: true, repeat: 5, ease: "sine.inOut" }, "walk")
        .to(group, { x: "+=" + jumpDist * 0.6, duration: 0.18 * 12, ease: "none" }, "walk");

      tl.to(legs, { rotation: 0, duration: 0.15, ease: "power2.out" });

      // ---- 6. Look down ----------------------------------------------------
      tl.to(eyes, { y: 3, duration: 0.3, ease: "power2.out" }, "+=0.1")
        .to(body, { rotation: 2, svgOrigin: "53 65", duration: 0.3, ease: "power2.out" }, "<");

      // Swap leg pivot back to FEET for the leap-back stretch.
      tl.call(() => {
        legs.forEach((l) => gsap.set(l, { svgOrigin: footOrigin(l) }));
      });

      // ---- 7. Crouch + leap back ------------------------------------------
      tl.addLabel("leapPrep")
        .to(body, { y: 8, rotation: 0, duration: 0.1, ease: "power3.in" }, "leapPrep")
        .to(eyes, { y: 0, duration: 0.1, ease: "power3.in" }, "<")
        .to(hands, { y: 10, duration: 0.1, ease: "power3.in" }, "<")
        .to(
          legs,
          {
            rotation: (i: number) => [7, 8, 8, 9][i],
            scaleY: (i: number) => [1.2, 1.25, 1.3, 1.35][i],
            duration: 0.1,
            ease: "power3.in",
          },
          "<"
        );

      tl.addLabel("leap")
        .to(legs, { scaleY: 1, rotation: 0, duration: 0.12, ease: "power1.out" }, "leap")
        .to(group, { x: 0, duration: 0.85, ease: "power1.inOut" }, "leap")
        .to(group, { y: -90, duration: 0.42, ease: "sine.out" }, "leap")
        .to(body, { y: -5, duration: 0.42, ease: "sine.out" }, "leap")
        .to(hands, { y: -6, duration: 0.42, ease: "sine.out" }, "leap")
        .to(group, { y: 0, duration: 0.2, ease: "power3.in" }, "leap+=0.6")
        .to(hands, { y: 6, duration: 0.05, ease: "power2.in" }, "leap+=0.8")
        .to(hands, { y: 0, duration: 0.18, ease: "elastic.out(1, 0.5)" }, ">");

      // ---- 8. Reset to neutral so the loop reads cleanly ------------------
      tl.call(() => {
        legs.forEach((l) => gsap.set(l, { svgOrigin: footOrigin(l) }));
      });
      tl.to(body, { y: 0, rotation: 0, x: 0, svgOrigin: "53 65", duration: 0.25, ease: "power2.out" })
        .to(eyes, { x: 0, y: 0, duration: 0.25, ease: "power2.out" }, "<")
        .to(hands, { y: 0, duration: 0.25, ease: "power2.out" }, "<");

      if (onTimeline) onTimeline(tl);
      if (!autoPlay) tl.pause();
    }, hostRef);

    return () => {
      tlRef.current?.kill();
      tlRef.current = null;
      ctx.revert();
    };
    // Build once per injected svg instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [svg]);

  // Real asset is 107x86; keep that aspect ratio. overflow visible so the jump
  // arc isn't clipped by the host box.
  return (
    <div
      ref={hostRef}
      className={className}
      style={{ width: size, height: (size * 86) / 107, overflow: "visible", lineHeight: 0 }}
      role="img"
      aria-label="Claude walking and jumping"
    />
  );
}
