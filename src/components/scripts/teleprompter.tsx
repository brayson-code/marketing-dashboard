'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  X, Play, Pause, Minus, Plus, FlipHorizontal2, RotateCcw, Type, Gauge,
} from 'lucide-react';
import { parseScript } from '@/lib/script-format';

// Full-screen teleprompter overlay. Big, high-contrast, auto-scrolling script
// text for recording. Portaled to <body> so the fixed overlay covers the real
// viewport (never trapped inside a transformed ancestor like a card-hover panel).
//
// Scrolling is driven by requestAnimationFrame: each frame we add
// speed(px/s) * deltaSeconds to scrollTop. Pausing stops the accumulation;
// hitting the bottom auto-pauses. Tap the text to toggle play/pause; Escape
// closes; Mirror flips the column horizontally for a teleprompter-glass rig.

const MIN_SPEED = 10;
const MAX_SPEED = 400;
const SPEED_STEP = 10;
const MIN_FONT = 20;
const MAX_FONT = 96;
const FONT_STEP = 4;

export function Teleprompter({ text, onClose }: { text: string; onClose: () => void }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(70); // px per second
  const [fontSize, setFontSize] = useState(44);
  const [mirror, setMirror] = useState(false);

  // rAF loop — keep the live values in refs so the loop never re-subscribes.
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  playingRef.current = playing;
  speedRef.current = speed;

  // Accumulate fractional pixels so slow speeds still scroll smoothly (scrollTop
  // is integer; we keep the remainder ourselves).
  const accRef = useRef(0);
  const lastTsRef = useRef<number | null>(null);

  useEffect(() => {
    let raf = 0;
    const tick = (ts: number) => {
      raf = requestAnimationFrame(tick);
      const el = scrollRef.current;
      if (!el) { lastTsRef.current = ts; return; }
      if (lastTsRef.current == null) { lastTsRef.current = ts; return; }
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (!playingRef.current) return;

      accRef.current += speedRef.current * dt;
      const whole = Math.floor(accRef.current);
      if (whole > 0) {
        accRef.current -= whole;
        const maxScroll = el.scrollHeight - el.clientHeight;
        const next = Math.min(el.scrollTop + whole, maxScroll);
        el.scrollTop = next;
        // Reached the end → stop.
        if (next >= maxScroll - 0.5) setPlaying(false);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Escape closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const restart = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
    accRef.current = 0;
    setPlaying(true);
  }, []);

  const bumpSpeed = useCallback((d: number) => {
    setSpeed((s) => Math.min(MAX_SPEED, Math.max(MIN_SPEED, s + d)));
  }, []);
  const bumpFont = useCallback((d: number) => {
    setFontSize((f) => Math.min(MAX_FONT, Math.max(MIN_FONT, f + d)));
  }, []);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-[#050505] animate-in"
      // 100dvh tracks the VISIBLE viewport so the controls bar isn't hidden behind
      // mobile browser chrome / the iOS home bar (the "can't see the speed buttons"
      // bug). inset-0 stays as the fallback for browsers without dvh.
      style={{ height: '100dvh' }}
      role="dialog"
      aria-modal="true"
      aria-label="Teleprompter"
    >
      {/* Close X — top-right, above everything. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close teleprompter"
        className="absolute top-3 right-3 z-20 btn btn-ghost btn-sm text-white/80 hover:text-white"
      >
        <X size={18} />
      </button>

      {/* Scrolling text column — click toggles play/pause. */}
      <div
        ref={scrollRef}
        onClick={() => setPlaying((p) => !p)}
        className="flex-1 overflow-y-auto overflow-x-hidden cursor-pointer select-none teleprompter-scroll"
        style={{ scrollbarWidth: 'none' }}
      >
        {/* Center reading line marker (subtle), fixed to the viewport center. */}
        <div
          aria-hidden
          className="pointer-events-none fixed left-0 right-0 top-1/2 -translate-y-1/2 h-px z-10"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.10) 18%, rgba(255,255,255,0.10) 82%, transparent)' }}
        />
        <div
          className="mx-auto w-full max-w-[16ch] sm:max-w-[18ch] md:max-w-[20ch] px-6 text-white whitespace-pre-wrap break-words font-semibold tracking-tight text-center"
          style={{
            fontSize: `${fontSize}px`,
            lineHeight: 1.32,
            // Big top/bottom padding so the first/last lines can reach the center reading line.
            paddingTop: '46vh',
            paddingBottom: '60vh',
            transform: mirror ? 'scaleX(-1)' : undefined,
            textShadow: '0 1px 18px rgba(0,0,0,0.6)',
          }}
        >
          {(() => {
            const blocks = parseScript(text);
            if (blocks.length === 0) return 'This script is empty.';
            return blocks.map((b, i) => (
              <div key={i} style={{ marginBottom: '1.1em' }}>
                {b.label && (
                  <div
                    style={{
                      color: 'var(--primary)',
                      fontSize: '0.62em',
                      letterSpacing: '0.14em',
                      fontWeight: 800,
                      marginBottom: b.cue ? '0.04em' : '0.12em',
                    }}
                  >
                    {b.label}
                  </div>
                )}
                {/* Delivery cue (tone/cadence) — small, dim, italic. NOT spoken;
                    it's a direction so the reader knows how to deliver the line. */}
                {b.cue && (
                  <div
                    style={{
                      color: 'rgba(255,255,255,0.42)',
                      fontSize: '0.42em',
                      fontStyle: 'italic',
                      fontWeight: 500,
                      letterSpacing: '0.01em',
                      marginBottom: '0.3em',
                    }}
                  >
                    🗣 {b.cue}
                  </div>
                )}
                {/* The words to say — each scene as its own spaced line so the
                    reader's eye can track beats while scrolling. */}
                {b.body && b.body.split('\n').map((line, j) => (
                  <div key={j} style={{ marginBottom: '0.34em' }}>{line}</div>
                ))}
              </div>
            ));
          })()}
        </div>
      </div>

      {/* Controls bar — pinned to the bottom. Extra bottom padding clears the iOS
          home bar so the speed/font controls are never hidden under it. */}
      <div
        className="shrink-0 z-20 flex items-center justify-center gap-2 flex-wrap px-4 py-3 border-t border-white/10 bg-black/70 backdrop-blur-md"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <button
          type="button"
          onClick={() => setPlaying((p) => !p)}
          className="btn btn-primary btn-sm"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}
        </button>

        <span className="mx-1 w-px h-5 bg-white/15" aria-hidden />

        {/* Speed */}
        <div className="flex items-center gap-1 text-white/85">
          <Gauge size={14} className="opacity-70" />
          <button type="button" onClick={() => bumpSpeed(-SPEED_STEP)} className="tp-btn" aria-label="Slower">
            <Minus size={14} />
          </button>
          <span className="font-mono tabular-nums text-xs w-[64px] text-center" title="Scroll speed (px/sec)">
            {speed} px/s
          </span>
          <button type="button" onClick={() => bumpSpeed(SPEED_STEP)} className="tp-btn" aria-label="Faster">
            <Plus size={14} />
          </button>
        </div>

        <span className="mx-1 w-px h-5 bg-white/15" aria-hidden />

        {/* Font size */}
        <div className="flex items-center gap-1 text-white/85">
          <Type size={14} className="opacity-70" />
          <button type="button" onClick={() => bumpFont(-FONT_STEP)} className="tp-btn" aria-label="Smaller text">
            <Minus size={14} />
          </button>
          <span className="font-mono tabular-nums text-xs w-[44px] text-center" title="Font size (px)">
            {fontSize}px
          </span>
          <button type="button" onClick={() => bumpFont(FONT_STEP)} className="tp-btn" aria-label="Larger text">
            <Plus size={14} />
          </button>
        </div>

        <span className="mx-1 w-px h-5 bg-white/15" aria-hidden />

        {/* Mirror */}
        <button
          type="button"
          onClick={() => setMirror((m) => !m)}
          aria-pressed={mirror}
          className="btn btn-ghost btn-sm text-white/85"
          style={mirror ? { background: 'color-mix(in srgb, var(--primary) 22%, transparent)', color: '#fff' } : undefined}
          title="Flip horizontally for teleprompter glass"
        >
          <FlipHorizontal2 size={14} /> Mirror
        </button>

        {/* Restart */}
        <button type="button" onClick={restart} className="btn btn-ghost btn-sm text-white/85" title="Scroll back to the top">
          <RotateCcw size={14} /> Restart
        </button>
      </div>

      {/* Scoped styles: hide the scrollbar and size the small control buttons. */}
      <style>{`
        .teleprompter-scroll::-webkit-scrollbar { width: 0; height: 0; }
        .tp-btn {
          display: inline-flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border-radius: 8px; color: rgba(255,255,255,0.85);
          transition: background-color var(--t-press) var(--ease-out);
        }
        .tp-btn:hover { background: rgba(255,255,255,0.12); }
        .tp-btn:active { transform: scale(0.94); }
      `}</style>
    </div>,
    document.body,
  );
}
