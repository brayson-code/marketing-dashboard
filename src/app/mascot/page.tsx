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
 * - Every animation with play/pause + restart controls.
 * - MascotDance "riding" a sample gradient progress bar.
 *
 * No sprite art is bundled, so Gym/Confetti/Flag render their framework
 * placeholders until PNG frames are dropped into public/sprites/<anim>/.
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

function Controls({
  playing,
  onToggle,
  onRestart,
}: {
  playing: boolean;
  onToggle: () => void;
  onRestart: () => void;
}) {
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
          marginTop: 34, // room for the mascot above the bar
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
        {/* Mascot rides the fill edge, anchored by its bottom-center. */}
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
        <button
          onClick={() => setPlaying((p) => !p)}
          style={{
            border: "1px solid #DD775B",
            background: "#fff",
            color: "#C2613F",
            borderRadius: 8,
            padding: "2px 12px",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>
      </div>
    </div>
  );
}

export default function MascotDemoPage() {
  // Walking timeline control
  const walkTl = useRef<gsap.core.Timeline | null>(null);
  const [walkPlaying, setWalkPlaying] = useState(true);

  const [gymPlaying, setGymPlaying] = useState(true);
  const [confettiPlaying, setConfettiPlaying] = useState(true);
  const [flagPlaying, setFlagPlaying] = useState(true);

  const [dancePlaying, setDancePlaying] = useState(true);

  const card: React.CSSProperties = {
    border: "1px solid #efe6e0",
    borderRadius: 16,
    padding: 24,
    background: "#fffdfb",
  };

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
          SVG + GSAP recreation following the Codrops reverse-engineering article. Built from
          <code style={{ background: "#f3ece7", padding: "1px 5px", borderRadius: 4 }}>
            &lt;rect&gt;
          </code>
          elements only.
        </p>
      </header>

      <Section
        title="Progress bar rider (MascotDance)"
        subtitle="The priority integration: a compact 30px idle loop that rides the fill edge of a gradient progress bar."
      >
        <div style={card}>
          <ProgressRider />
        </div>
      </Section>

      <Section
        title="MascotDance — standalone"
        subtitle="Crisp bob + wiggle + squash/stretch loop at small sizes. Accepts a size prop."
      >
        <div style={{ ...card, display: "flex", alignItems: "flex-end", gap: 32 }}>
          <MascotDance size={24} playing={dancePlaying} />
          <MascotDance size={34} playing={dancePlaying} />
          <MascotDance size={64} playing={dancePlaying} />
          <MascotDance size={96} playing={dancePlaying} />
          <div style={{ marginLeft: "auto" }}>
            <Controls
              playing={dancePlaying}
              onToggle={() => setDancePlaying((p) => !p)}
              onRestart={() => setDancePlaying((p) => p)}
            />
          </div>
        </div>
      </Section>

      <Section
        title="WalkingClaude — pure GSAP tween"
        subtitle="Look around → lean → crouch → jump arc → walk across → look down → crouch → leap back. Loops forever."
      >
        <div style={{ ...card, overflow: "hidden" }}>
          <WalkingClaude
            size={260}
            jumpDist={70}
            onTimeline={(tl) => {
              walkTl.current = tl;
            }}
          />
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
        title="Sprite-frame animations (framework + placeholders)"
        subtitle="Frame-toggle engine with per-frame timing tables, confetti bursts, and flag hand/sway offsets. Drop PNGs into public/sprites/<anim>/ to light them up."
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 20,
          }}
        >
          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>GymClaude (lifting)</h3>
            <GymClaude size={200} playing={gymPlaying} />
            <Controls
              playing={gymPlaying}
              onToggle={() => setGymPlaying((p) => !p)}
              onRestart={() => setGymPlaying((p) => p)}
            />
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>ConfettiClaude (stomping)</h3>
            <ConfettiClaude size={200} playing={confettiPlaying} />
            <Controls
              playing={confettiPlaying}
              onToggle={() => setConfettiPlaying((p) => !p)}
              onRestart={() => setConfettiPlaying((p) => p)}
            />
          </div>

          <div style={card}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15 }}>FlagWaver (waving)</h3>
            <FlagWaver size={200} playing={flagPlaying} />
            <Controls
              playing={flagPlaying}
              onToggle={() => setFlagPlaying((p) => !p)}
              onRestart={() => setFlagPlaying((p) => p)}
            />
          </div>
        </div>
      </Section>
    </main>
  );
}
