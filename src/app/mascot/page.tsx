"use client";

import { useEffect, useRef, useState } from "react";
import type { gsap } from "gsap";
import {
  WalkingClaude,
  MascotDance,
  GymClaude,
  ConfettiClaude,
  FlagWaver,
} from "@/components/mascot";

/**
 * Demo route for the Claude mascot animation kit.
 *
 * Showcases the FOUR real-SVG animations (assets in public/sprites/, driven by
 * GSAP) plus the synthetic MascotDance idle:
 *   - WalkingClaude  — tweened walk/jump on the real claude-walking.svg rig
 *   - GymClaude      — frame-cycled lift   (claude-gym.svg)
 *   - FlagWaver      — frame-cycled wave   (claude-flag-waver.svg)
 *   - ConfettiClaude — frame-cycled stomp  (claude-confetti.svg)
 *
 * Each has play/pause + restart wired through the component's GSAP timeline.
 */

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginBottom: 48 }}>
      <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 4px", color: "#1f1a17" }}>
        {title}
      </h2>
      <p style={{ margin: "0 0 16px", color: "#8a7a70", fontSize: 14 }}>{subtitle}</p>
      {children}
    </section>
  );
}

const btn: React.CSSProperties = {
  border: "1px solid #DD775B",
  background: "#fff",
  color: "#C2613F",
  borderRadius: 8,
  padding: "6px 14px",
  fontSize: 13,
  fontWeight: 600,
  cursor: "pointer",
};

function Controls({
  playing,
  onToggle,
  onRestart,
}: {
  playing: boolean;
  onToggle: () => void;
  onRestart: () => void;
}) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
      <button style={btn} onClick={onToggle}>
        {playing ? "Pause" : "Play"}
      </button>
      <button style={btn} onClick={onRestart}>
        Restart
      </button>
    </div>
  );
}

/** Shared prop shape of the three frame animations. */
type FrameAnim = React.ComponentType<{
  size?: number;
  onTimeline?: (tl: gsap.core.Timeline) => void;
}>;

/**
 * A timeline-backed animation card. Captures the animation's GSAP timeline via
 * its `onTimeline` prop and drives play/pause/restart through it (no remount).
 */
function TimelineCard({
  title,
  asset,
  Component,
}: {
  title: string;
  asset: string;
  Component: FrameAnim;
}) {
  const tlRef = useRef<gsap.core.Timeline | null>(null);
  const [playing, setPlaying] = useState(true);

  return (
    <div style={card}>
      <h3 style={{ margin: "0 0 2px", fontSize: 15, color: "#1f1a17" }}>{title}</h3>
      <code style={{ fontSize: 11, color: "#8a7a70" }}>{asset}</code>
      <div
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: 180,
          marginTop: 8,
          overflow: "visible",
        }}
      >
        <Component
          size={200}
          onTimeline={(tl) => {
            tlRef.current = tl;
          }}
        />
      </div>
      <Controls
        playing={playing}
        onToggle={() => {
          const tl = tlRef.current;
          if (!tl) return;
          if (playing) tl.pause();
          else tl.play();
          setPlaying((p) => !p);
        }}
        onRestart={() => {
          tlRef.current?.restart();
          setPlaying(true);
        }}
      />
    </div>
  );
}

/** A self-animating progress bar with MascotDance riding the fill edge. */
function ProgressRider() {
  const [pct, setPct] = useState(12);
  const [playing, setPlaying] = useState(true);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setPct((p) => (p >= 96 ? 12 : p + 1));
    }, 90);
    return () => clearInterval(id);
  }, [playing]);

  return (
    <div>
      <div
        style={{
          position: "relative",
          height: 14,
          borderRadius: 999,
          background: "#efe6e0",
          marginTop: 34,
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            width: `${pct}%`,
            borderRadius: 999,
            background: "linear-gradient(90deg, #E8B04B, #DD775B)",
            transition: "width 90ms linear",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: `${pct}%`,
            bottom: 6,
            transform: "translate(-50%, 0)",
            transition: "left 90ms linear",
            pointerEvents: "none",
          }}
        >
          <MascotDance size={30} playing={playing} />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
        <span style={{ fontSize: 12, color: "#8a7a70" }}>{pct}% — dance idle rides the edge</span>
        <button onClick={() => setPlaying((p) => !p)} style={{ ...btn, padding: "2px 12px", fontSize: 12 }}>
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid #efe6e0",
  borderRadius: 16,
  padding: 24,
  background: "#fffdfb",
};

export default function MascotDemoPage() {
  const walkTl = useRef<gsap.core.Timeline | null>(null);
  const [walkPlaying, setWalkPlaying] = useState(true);
  const [dancePlaying, setDancePlaying] = useState(true);

  return (
    <main
      style={{
        maxWidth: 920,
        margin: "0 auto",
        padding: "48px 24px 96px",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial",
      }}
    >
      <header style={{ marginBottom: 40 }}>
        <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 6px", color: "#1f1a17" }}>
          Claude Mascot Animations
        </h1>
        <p style={{ margin: 0, color: "#8a7a70", fontSize: 15 }}>
          The four official Claude mascot SVGs (in{" "}
          <code style={{ background: "#f3ece7", padding: "1px 5px", borderRadius: 4 }}>
            public/sprites/
          </code>
          ) injected at runtime and driven by GSAP, following the Codrops
          reverse-engineering article.
        </p>
      </header>

      <Section
        title="WalkingClaude — tweened walk + jump"
        subtitle="Real claude-walking.svg rig. Look around → lean → crouch → jump arc → walk across → look down → crouch → leap back. Loops forever."
      >
        <div style={{ ...card, overflow: "visible" }}>
          <div style={{ display: "grid", placeItems: "center", minHeight: 220, overflow: "visible" }}>
            <WalkingClaude
              size={260}
              jumpDist={70}
              onTimeline={(tl) => {
                walkTl.current = tl;
              }}
            />
          </div>
          <Controls
            playing={walkPlaying}
            onToggle={() => {
              const tl = walkTl.current;
              if (!tl) return;
              if (walkPlaying) tl.pause();
              else tl.play();
              setWalkPlaying((p) => !p);
            }}
            onRestart={() => {
              walkTl.current?.restart();
              setWalkPlaying(true);
            }}
          />
        </div>
      </Section>

      <Section
        title="Frame-cycled animations (real SVGs)"
        subtitle="Each SVG bundles many frame <g> groups; GSAP cycles which one is display:inline on a looping timeline with per-frame timing. Frame groups are detected from the live DOM (see README)."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 20,
          }}
        >
          <TimelineCard
            title="GymClaude (lifting · 12 frames)"
            asset="/sprites/claude-gym.svg"
            Component={GymClaude}
          />
          <TimelineCard
            title="ConfettiClaude (stomping · 8 frames)"
            asset="/sprites/claude-confetti.svg"
            Component={ConfettiClaude}
          />
          <TimelineCard
            title="FlagWaver (waving · 36 frames)"
            asset="/sprites/claude-flag-waver.svg"
            Component={FlagWaver}
          />
        </div>
      </Section>

      <Section
        title="MascotDance — synthetic idle"
        subtitle="A compact <rect>-only idle loop (not from a sprite asset) tuned to ride a progress bar's fill edge at small sizes."
      >
        <div style={card}>
          <ProgressRider />
        </div>
        <div style={{ ...card, display: "flex", alignItems: "flex-end", gap: 32, marginTop: 20 }}>
          <MascotDance size={24} playing={dancePlaying} />
          <MascotDance size={34} playing={dancePlaying} />
          <MascotDance size={64} playing={dancePlaying} />
          <MascotDance size={96} playing={dancePlaying} />
          <div style={{ marginLeft: "auto" }}>
            <button style={btn} onClick={() => setDancePlaying((p) => !p)}>
              {dancePlaying ? "Pause" : "Play"}
            </button>
          </div>
        </div>
      </Section>
    </main>
  );
}
