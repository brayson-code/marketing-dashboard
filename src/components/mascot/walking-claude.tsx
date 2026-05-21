"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { MascotArt, type MascotPartRefs } from "./mascot-art";

export interface WalkingClaudeProps {
  size?: number;
  color?: string;
  className?: string;
  /** How far (in viewBox-ish px, applied to the wrapping <g>) Claude leaps. */
  jumpDist?: number;
  /** Set false to mount paused (play() via ref-less control isn't exposed; use the demo controls). */
  autoPlay?: boolean;
  /** Receives the master timeline once built, e.g. for external play/pause. */
  onTimeline?: (tl: gsap.core.Timeline) => void;
}

/**
 * WalkingClaude — a faithful, PURE-GSAP recreation of the article's hero
 * animation. No sprite art: every motion is a tween on the <rect> parts.
 *
 * Sequence (looped, repeat:-1):
 *   look around -> lean -> crouch -> jump (parabolic arc) -> walk across
 *   -> look down -> crouch -> leap back -> reset
 *
 * Key techniques from the article:
 *   - The Lean fires eyes + body + legs simultaneously via the "<" position
 *     parameter, 0.4s, ease "power2.out". Body rotation -3deg, svgOrigin "53 65".
 *     Legs get per-element rotation [-7,-8,-8,-9] and scaleY [1.35,1.3,1.2,1.15]
 *     via function-based values (i) => arr[i].
 *   - A .call() mid-timeline swaps each leg's svgOrigin from the HIP (top of the
 *     rect) to the FEET (bottom, y=86) so the walk pivots correctly, then swaps
 *     it back afterwards.
 *   - The Crouch dips the body y by +8 (0.1s, power3.in) with the hands dropping
 *     in parallel.
 *   - The Jump uses timeline labels + relative offsets: horizontal 0.85s
 *     power1.inOut at label "jump"; vertical ascent to -90 over 0.42s sine.out
 *     also at "jump"; descent back to 0 over 0.2s power3.in at "jump+=0.6";
 *     plus a tiny hand-landing overshoot (0.05s).
 */
export function WalkingClaude({
  size = 240,
  color,
  className,
  jumpDist = 60,
  autoPlay = true,
  onTimeline,
}: WalkingClaudeProps) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef<MascotPartRefs | null>(null);
  const tlRef = useRef<gsap.core.Timeline | null>(null);

  useEffect(() => {
    const parts = partsRef.current;
    if (!parts || !parts.group || !parts.body || !parts.eyes) return;
    const legs = parts.legs.filter(Boolean) as SVGRectElement[];
    if (legs.length < 4) return;

    const ctx = gsap.context(() => {
      const { group, body, eyes, leftHand, rightHand } = parts;
      const hands = [leftHand, rightHand].filter(Boolean) as SVGRectElement[];

      // Leg pivot points. Hips = top of rect (y=60); feet = bottom (y=86).
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
      tl.to(
        legs,
        { scaleY: 1, rotation: 0, duration: 0.12, ease: "power1.out" },
        ">-0.02"
      );

      // ---- 4. The Jump (parabolic arc via labels + relative offsets) ------
      tl.addLabel("jump")
        // horizontal carry across the full jump duration
        .to(group, { x: "+=" + jumpDist, duration: 0.85, ease: "power1.inOut" }, "jump")
        // body unfolds / un-crouches during launch
        .to(body, { y: -5, rotation: 0, duration: 0.42, ease: "sine.out" }, "jump")
        .to(eyes, { x: 0, y: -3, duration: 0.42, ease: "sine.out" }, "jump")
        // vertical ascent
        .to(group, { y: -90, duration: 0.42, ease: "sine.out" }, "jump")
        // hands tuck up while airborne
        .to(hands, { y: -6, duration: 0.42, ease: "sine.out" }, "jump")
        // vertical descent (gravity), heavier ease, starting partway through
        .to(group, { y: 0, duration: 0.2, ease: "power3.in" }, "jump+=0.6")
        // small hand-landing overshoot then settle
        .to(hands, { y: 6, duration: 0.05, ease: "power2.in" }, "jump+=0.8")
        .to(eyes, { y: 0, duration: 0.05 }, "jump+=0.8")
        .to(hands, { y: 0, duration: 0.18, ease: "elastic.out(1, 0.5)" }, ">");

      // ---- 5. Switch leg pivot to the HIP, then walk across ---------------
      tl.call(() => {
        legs.forEach((l) => gsap.set(l, { svgOrigin: hipOrigin(l) }));
      });

      tl.addLabel("walk");
      // Alternating leg swing — front pair vs back pair out of phase.
      tl.to(
        [legs[0], legs[2]],
        {
          rotation: 14,
          duration: 0.18,
          yoyo: true,
          repeat: 5,
          ease: "sine.inOut",
        },
        "walk"
      )
        .to(
          [legs[1], legs[3]],
          {
            rotation: -14,
            duration: 0.18,
            yoyo: true,
            repeat: 5,
            ease: "sine.inOut",
          },
          "walk"
        )
        // little body bob while walking
        .to(
          body,
          { y: -2, duration: 0.18, yoyo: true, repeat: 5, ease: "sine.inOut" },
          "walk"
        )
        // travel forward during the walk
        .to(group, { x: "+=" + jumpDist * 0.6, duration: 0.18 * 12, ease: "none" }, "walk");

      // settle legs flat after walking
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
        // leap back the full distance travelled (jump + walk)
        .to(
          group,
          { x: 0, duration: 0.85, ease: "power1.inOut" },
          "leap"
        )
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
      tl.to([body], { y: 0, rotation: 0, x: 0, svgOrigin: "53 65", duration: 0.25, ease: "power2.out" })
        .to(eyes, { x: 0, y: 0, duration: 0.25, ease: "power2.out" }, "<")
        .to(hands, { y: 0, duration: 0.25, ease: "power2.out" }, "<");

      if (onTimeline) onTimeline(tl);
      if (!autoPlay) tl.pause();
    }, scopeRef);

    return () => {
      ctx.revert(); // kills all tweens + restores inline styles
      tlRef.current = null;
    };
    // We intentionally build the timeline once; jumpDist/autoPlay changes
    // should remount via key from the parent if needed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={scopeRef} className={className}>
      <MascotArt
        size={size}
        color={color}
        onParts={(p) => {
          partsRef.current = p;
        }}
      />
    </div>
  );
}
