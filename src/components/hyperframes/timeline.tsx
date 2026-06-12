'use client';

// Horizontal timeline view for the Hyperframes editor.
// Renders below / instead of the scene strip when the user toggles "Timeline"
// in the canvas header. Shares the same comp state + patch callbacks.
//
// Track layout (top → bottom):
//   • Time ruler
//   • Scenes track   — blocks, drag right edge = resize duration
//   • B-roll track   — bars, drag body = move, edges = resize
//   • Text / infographics track — read-only text labels; infographics are
//                                 draggable + resizable like b-roll bars
//   • Punch-beat band — diamond markers, draggable left/right
//   • Caption style indicator strip (presence only, when caption_style set)

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Film, Type, Hash, ListChecks, BarChart3, Diamond, AlignLeft } from 'lucide-react';
import {
  msToPx,
  pxToMs,
  resizeScene,
  moveOverlay,
  resizeOverlay,
  moveInfographic,
  resizeInfographic,
  movePunchBeat,
} from '@/lib/timeline-model';
import type {
  Composition,
} from '@/lib/hyperframes-composition';

// ── Selection identifiers (mirrors editor's own selection state) ─────────────

export type TimelineSelection =
  | { kind: 'scene'; sceneIdx: number }
  | { kind: 'layer'; sceneIdx: number; layerId: string }
  | { kind: 'infographic'; sceneIdx: number; igIdx: number }
  | { kind: 'overlay'; sceneIdx: number; overlayIdx: number }
  | { kind: 'punch'; sceneIdx: number; beatIdx: number };

// ── Zoom presets ─────────────────────────────────────────────────────────────

const ZOOM_FIT = 'fit' as const;
type ZoomPreset = typeof ZOOM_FIT | 50 | 100 | 200;
const ZOOM_PRESETS: ZoomPreset[] = [ZOOM_FIT, 50, 100, 200];
const ZOOM_LABELS: Record<string, string> = { fit: 'Fit', '50': '50px/s', '100': '100px/s', '200': '200px/s' };

// ── Track heights / constants ─────────────────────────────────────────────────

const RULER_H = 22;       // px — time ruler
const TRACK_H = 28;       // px — every content track
const SCENE_H = TRACK_H;
const BROLL_H = TRACK_H;
const TEXT_H = TRACK_H;
const PUNCH_H = 20;       // punch-beat row (diamonds)
const CAPTION_H = 8;      // thin strip indicating caption style
const GAP = 2;            // gap between track rows
const HANDLE_W = 6;       // resize handle width px
// const MIN_DRAG_PX = 3; // reserved: pointer must move at least this far to register a drag

// How far (in px) to extend the scrollable canvas past the last scene.
const RIGHT_PADDING_PX = 80;

// ── Helpers ──────────────────────────────────────────────────────────────────

function totalDurationMs(comp: Composition): number {
  if (!comp.scenes.length) return 3000;
  const last = comp.scenes[comp.scenes.length - 1];
  return last.endMs;
}

function resolvedZoom(preset: ZoomPreset, containerW: number, durationMs: number): number {
  if (preset === ZOOM_FIT) {
    const fitZoom = (containerW - RIGHT_PADDING_PX) / Math.max(0.001, durationMs / 1000);
    return Math.max(10, fitZoom);
  }
  return preset;
}

// clamp is available for future use in drag handler calculations.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

// Format time ruler tick labels.
function tickLabel(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  if (m > 0) return `${m}:${rem.toFixed(rem % 1 === 0 ? 0 : 1).padStart(2, '0')}`;
  return `${rem % 1 === 0 ? rem.toFixed(0) : rem.toFixed(1)}s`;
}

// Pick a "nice" tick interval (in ms) for the ruler given zoom.
function tickIntervalMs(pxPerSec: number): number {
  // We want ticks roughly every 60–100px.
  const msPerPx = 1000 / pxPerSec;
  const targetMs = 70 * msPerPx; // target ~70px between ticks
  const nices = [100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000];
  for (const n of nices) { if (n >= targetMs) return n; }
  return 60000;
}

// ── Track-label column width ─────────────────────────────────────────────────

const LABEL_W = 80; // px for the left label column

// ── Main component ───────────────────────────────────────────────────────────

export interface TimelineProps {
  comp: Composition;
  sceneIdx: number;
  selectedLayerId: string | null;
  selectedIg: number | null;
  onChange: (next: Composition) => void;
  onSelect: (sel: TimelineSelection) => void;
}

export function Timeline({
  comp,
  sceneIdx,
  selectedLayerId,
  selectedIg,
  onChange,
  onSelect,
}: TimelineProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [zoom, setZoom] = useState<ZoomPreset>(ZOOM_FIT);
  const [containerW, setContainerW] = useState(800);

  // Observe container width for fit-zoom.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setContainerW(w - LABEL_W);
    });
    ro.observe(el);
    setContainerW(el.clientWidth - LABEL_W);
    return () => ro.disconnect();
  }, []);

  const pxPerSec = useMemo(
    () => resolvedZoom(zoom, containerW, totalDurationMs(comp)),
    [zoom, containerW, comp],
  );

  const totalW = msToPx(totalDurationMs(comp), pxPerSec) + RIGHT_PADDING_PX;

  // ── drag state ─────────────────────────────────────────────────────────────

  type DragTarget =
    | { kind: 'scene-resize'; sceneIdx: number; startX: number; origDurationMs: number }
    | { kind: 'overlay-move'; sceneIdx: number; ovIdx: number; startX: number; origStart: number }
    | { kind: 'overlay-resize'; sceneIdx: number; ovIdx: number; startX: number; origDuration: number }
    | { kind: 'ig-move'; sceneIdx: number; igIdx: number; startX: number; origStart: number }
    | { kind: 'ig-resize'; sceneIdx: number; igIdx: number; startX: number; origDuration: number; sceneDurS: number }
    | { kind: 'punch'; sceneIdx: number; beatIdx: number; startX: number; origTime: number; sceneDurS: number };

  const dragRef = useRef<DragTarget | null>(null);
  const hasDragged = useRef(false);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const scroll = scrollRef.current?.scrollLeft ?? 0;
    const el = scrollRef.current;
    const containerLeft = (el?.getBoundingClientRect().left ?? 0) + LABEL_W;
    const rawPx = e.clientX - containerLeft + scroll;
    hasDragged.current = true;

    if (d.kind === 'scene-resize') {
      const dxPx = e.clientX - d.startX;
      const deltaMs = pxToMs(dxPx, pxPerSec);
      const newDuration = Math.max(500, d.origDurationMs + deltaMs);
      onChange(resizeScene(comp, d.sceneIdx, newDuration));
    } else if (d.kind === 'overlay-move') {
      const scene = comp.scenes[d.sceneIdx];
      if (!(scene.overlays ?? [])[d.ovIdx]) return;
      const dxPx = e.clientX - d.startX;
      const newStart = d.origStart + pxToMs(dxPx, pxPerSec) / 1000;
      onChange(moveOverlay(comp, d.sceneIdx, d.ovIdx, newStart));
    } else if (d.kind === 'overlay-resize') {
      const dxPx = e.clientX - d.startX;
      const newDuration = d.origDuration + pxToMs(dxPx, pxPerSec) / 1000;
      onChange(resizeOverlay(comp, d.sceneIdx, d.ovIdx, newDuration));
    } else if (d.kind === 'ig-move') {
      const dxPx = e.clientX - d.startX;
      const newStart = d.origStart + pxToMs(dxPx, pxPerSec) / 1000;
      onChange(moveInfographic(comp, d.sceneIdx, d.igIdx, newStart));
    } else if (d.kind === 'ig-resize') {
      // origDuration is always resolved at drag start (ig.duration ?? rest-of-scene).
      const dxPx = e.clientX - d.startX;
      const newDuration = d.origDuration + pxToMs(dxPx, pxPerSec) / 1000;
      onChange(resizeInfographic(comp, d.sceneIdx, d.igIdx, newDuration));
    } else if (d.kind === 'punch') {
      const scene = comp.scenes[d.sceneIdx];
      const sceneStartPx = msToPx(scene.startMs, pxPerSec);
      const newTimePx = rawPx - sceneStartPx;
      const newTime = pxToMs(Math.max(0, newTimePx), pxPerSec) / 1000;
      onChange(movePunchBeat(comp, d.sceneIdx, d.beatIdx, newTime));
    } else {
      // rawPx consumed only by punch; void for other branches.
      void rawPx;
    }
  }, [comp, onChange, pxPerSec]);

  // stableUpRef holds the pointerup handler that deregisters both listeners.
  // It's recreated in an effect whenever onPointerMove changes identity, so
  // startDrag always adds the handler that removes the current onPointerMove.
  const stableUpRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const up = () => {
      dragRef.current = null;
      hasDragged.current = false;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', up);
    };
    stableUpRef.current = up;
  }, [onPointerMove]);

  const startDrag = useCallback((target: DragTarget) => {
    dragRef.current = target;
    hasDragged.current = false;
    window.addEventListener('pointermove', onPointerMove);
    if (stableUpRef.current) window.addEventListener('pointerup', stableUpRef.current);
  }, [onPointerMove]);

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove);
    if (stableUpRef.current) window.removeEventListener('pointerup', stableUpRef.current);
  }, [onPointerMove]);

  // ── ruler ticks ────────────────────────────────────────────────────────────

  const tickInterval = tickIntervalMs(pxPerSec);
  const totalMs = totalDurationMs(comp);
  const ticks = useMemo(() => {
    const out: number[] = [];
    let t = 0;
    while (t <= totalMs + tickInterval) {
      out.push(t);
      t += tickInterval;
    }
    return out;
  }, [tickInterval, totalMs]);

  // ── row y positions ────────────────────────────────────────────────────────

  const rulerY = 0;
  const sceneY = rulerY + RULER_H + GAP;
  const brollY = sceneY + SCENE_H + GAP;
  const textY = brollY + BROLL_H + GAP;
  const punchY = textY + TEXT_H + GAP;
  const captionY = punchY + PUNCH_H + GAP;
  const hasCaptions = !!comp.caption_style;
  const totalH = captionY + (hasCaptions ? CAPTION_H + GAP : 0) + 4;

  // ── scene color helper ─────────────────────────────────────────────────────

  const SCENE_COLORS = [
    'var(--primary)',
    '#8B5CF6',
    '#06B6D4',
    '#F59E0B',
    '#10B981',
    '#EF4444',
    '#EC4899',
  ];
  function sceneColor(i: number) { return SCENE_COLORS[i % SCENE_COLORS.length]; }

  return (
    <div
      ref={containerRef}
      className="flex flex-col select-none bg-[color-mix(in_srgb,var(--surface-2)_30%,transparent)]"
      style={{ borderTop: '1px solid var(--border)', minHeight: totalH + RULER_H }}
    >
      {/* Toolbar: zoom presets */}
      <div className="flex items-center gap-1 px-3 py-1 border-b border-border/40 shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mr-1">Zoom</span>
        {ZOOM_PRESETS.map((z) => (
          <button
            key={String(z)}
            onClick={() => setZoom(z)}
            className="btn btn-ghost btn-xs text-[10px]"
            style={{
              background: zoom === z ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent',
              color: zoom === z ? 'var(--primary)' : 'var(--muted-foreground)',
              minHeight: 18,
              padding: '1px 8px',
            }}
          >
            {ZOOM_LABELS[String(z)]}
          </button>
        ))}
      </div>

      {/* Main timeline area: label col + scrollable canvas */}
      <div className="flex flex-1 min-h-0" style={{ height: totalH + 4 }}>
        {/* Label column */}
        <div
          className="shrink-0 border-r border-border/40"
          style={{ width: LABEL_W }}
        >
          {/* Ruler spacer */}
          <div style={{ height: RULER_H }} />
          {/* Scene label */}
          <TrackLabel icon={<Film size={9} />} label="Scenes" h={SCENE_H} />
          {/* B-roll label */}
          <TrackLabel icon={<Film size={9} className="opacity-50" />} label="B-roll" h={BROLL_H} />
          {/* Text/IG label */}
          <TrackLabel icon={<Type size={9} />} label="Text / IGs" h={TEXT_H} />
          {/* Punch label */}
          <TrackLabel icon={<Diamond size={8} />} label="Punches" h={PUNCH_H} />
          {/* Caption strip label */}
          {hasCaptions && <TrackLabel label="Captions" h={CAPTION_H} />}
        </div>

        {/* Scrollable canvas */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto overflow-y-hidden"
        >
          <div
            className="relative"
            style={{ width: totalW, height: totalH }}
          >
            {/* Ruler */}
            <div
              className="absolute left-0 right-0"
              style={{ top: rulerY, height: RULER_H, background: 'color-mix(in srgb, var(--surface-2) 50%, transparent)' }}
            >
              {ticks.map((ms) => {
                const x = msToPx(ms, pxPerSec);
                return (
                  <div key={ms} className="absolute top-0 flex flex-col items-start pointer-events-none" style={{ left: x }}>
                    <div style={{ width: 1, height: 6, background: 'var(--border)' }} />
                    <span style={{ fontSize: 8, color: 'var(--muted-foreground)', marginLeft: 2, lineHeight: 1 }}>
                      {tickLabel(ms)}
                    </span>
                  </div>
                );
              })}
            </div>

            {/* Playhead line at current scene start */}
            {(() => {
              const x = msToPx(comp.scenes[sceneIdx]?.startMs ?? 0, pxPerSec);
              return (
                <div
                  className="absolute top-0 pointer-events-none z-20"
                  style={{
                    left: x,
                    width: 1,
                    height: totalH,
                    background: 'color-mix(in srgb, var(--primary) 70%, transparent)',
                  }}
                />
              );
            })()}

            {/* Scenes track */}
            <div className="absolute left-0" style={{ top: sceneY, height: SCENE_H, right: 0 }}>
              {comp.scenes.map((s, i) => {
                const x = msToPx(s.startMs, pxPerSec);
                const w = Math.max(2, msToPx(s.endMs - s.startMs, pxPerSec));
                const active = i === sceneIdx;
                const color = sceneColor(i);
                return (
                  <div
                    key={s.id}
                    className="absolute top-0 flex items-center overflow-hidden rounded-sm cursor-pointer"
                    style={{
                      left: x + 1,
                      width: Math.max(2, w - 2),
                      height: SCENE_H,
                      background: active
                        ? `color-mix(in srgb, ${color} 28%, transparent)`
                        : `color-mix(in srgb, ${color} 14%, transparent)`,
                      border: `1px solid color-mix(in srgb, ${color} ${active ? 70 : 35}%, transparent)`,
                    }}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      onSelect({ kind: 'scene', sceneIdx: i });
                    }}
                  >
                    <span
                      className="text-[9px] font-semibold truncate px-1 pointer-events-none"
                      style={{ color }}
                    >
                      {s.label ?? `#${i + 1}`}
                    </span>
                    {/* Resize handle — right edge */}
                    <div
                      className="absolute top-0 right-0 cursor-col-resize z-10"
                      style={{ width: HANDLE_W, height: SCENE_H, background: `color-mix(in srgb, ${color} 50%, transparent)` }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startDrag({
                          kind: 'scene-resize',
                          sceneIdx: i,
                          startX: e.clientX,
                          origDurationMs: s.endMs - s.startMs,
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* B-roll track */}
            <div className="absolute left-0" style={{ top: brollY, height: BROLL_H, right: 0 }}>
              {/* Track background per-scene zone */}
              {comp.scenes.map((s, i) => {
                const x = msToPx(s.startMs, pxPerSec);
                const w = msToPx(s.endMs - s.startMs, pxPerSec);
                return (
                  <div
                    key={s.id}
                    className="absolute top-0"
                    style={{
                      left: x,
                      width: w,
                      height: BROLL_H,
                      background: `color-mix(in srgb, ${sceneColor(i)} 4%, transparent)`,
                      borderLeft: `1px solid color-mix(in srgb, ${sceneColor(i)} 18%, transparent)`,
                    }}
                  />
                );
              })}
              {/* Overlays */}
              {comp.scenes.map((s, si) =>
                (s.overlays ?? []).map((ov, oi) => {
                  const sceneStartPx = msToPx(s.startMs, pxPerSec);
                  const x = sceneStartPx + msToPx(ov.start * 1000, pxPerSec);
                  const w = Math.max(4, msToPx(ov.duration * 1000, pxPerSec));
                  return (
                    <div
                      key={`${si}-ov-${oi}`}
                      className="absolute top-0.5 rounded-sm overflow-hidden cursor-grab"
                      style={{
                        left: x,
                        width: Math.max(4, w - 2),
                        height: BROLL_H - 4,
                        background: 'color-mix(in srgb, #06B6D4 30%, transparent)',
                        border: '1px solid color-mix(in srgb, #06B6D4 60%, transparent)',
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'overlay', sceneIdx: si, overlayIdx: oi });
                        startDrag({
                          kind: 'overlay-move',
                          sceneIdx: si,
                          ovIdx: oi,
                          startX: e.clientX,
                          origStart: ov.start,
                        });
                      }}
                    >
                      <span className="text-[8px] text-white/80 px-1 truncate block leading-tight pt-0.5 pointer-events-none">
                        {ov.frame === 'inset' ? 'PiP' : 'Full'} {ov.start.toFixed(1)}s
                      </span>
                      {/* Right resize handle */}
                      <div
                        className="absolute top-0 right-0 cursor-col-resize"
                        style={{ width: HANDLE_W, height: BROLL_H - 4, background: 'rgba(6,182,212,0.4)' }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startDrag({
                            kind: 'overlay-resize',
                            sceneIdx: si,
                            ovIdx: oi,
                            startX: e.clientX,
                            origDuration: ov.duration,
                          });
                        }}
                      />
                    </div>
                  );
                }),
              )}
            </div>

            {/* Text / Infographics track */}
            <div className="absolute left-0" style={{ top: textY, height: TEXT_H, right: 0 }}>
              {/* Scene zone backgrounds */}
              {comp.scenes.map((s, i) => {
                const x = msToPx(s.startMs, pxPerSec);
                const w = msToPx(s.endMs - s.startMs, pxPerSec);
                return (
                  <div
                    key={s.id}
                    className="absolute top-0"
                    style={{
                      left: x,
                      width: w,
                      height: TEXT_H,
                      background: `color-mix(in srgb, ${sceneColor(i)} 4%, transparent)`,
                      borderLeft: `1px solid color-mix(in srgb, ${sceneColor(i)} 18%, transparent)`,
                    }}
                  />
                );
              })}

              {/* Text layers — read-only bar spanning full scene */}
              {comp.scenes.map((s, si) =>
                s.layers.map((l, li) => {
                  const x = msToPx(s.startMs, pxPerSec);
                  const w = msToPx(s.endMs - s.startMs, pxPerSec);
                  const isSelected = si === sceneIdx && l.id === selectedLayerId;
                  return (
                    <div
                      key={`${si}-tl-${l.id}`}
                      className="absolute cursor-pointer flex items-center overflow-hidden"
                      style={{
                        left: x + 1,
                        top: 2 + li * 3,
                        width: Math.max(2, (w - 2) * (l.widthPct / 100)),
                        height: TEXT_H - 4,
                        background: isSelected
                          ? 'color-mix(in srgb, var(--primary) 22%, transparent)'
                          : 'color-mix(in srgb, var(--primary) 10%, transparent)',
                        border: `1px solid color-mix(in srgb, var(--primary) ${isSelected ? 60 : 25}%, transparent)`,
                        borderRadius: 2,
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'layer', sceneIdx: si, layerId: l.id });
                      }}
                      title={l.text}
                    >
                      <AlignLeft size={7} className="shrink-0 mx-1 opacity-50" />
                      <span className="text-[8px] truncate pointer-events-none" style={{ color: 'var(--primary)', opacity: 0.8 }}>
                        {l.text || '(empty)'}
                      </span>
                    </div>
                  );
                }),
              )}

              {/* Infographics — draggable + resizable */}
              {comp.scenes.map((s, si) =>
                (s.infographics ?? []).map((ig, igi) => {
                  const sceneDurS = (s.endMs - s.startMs) / 1000;
                  const sceneStartPx = msToPx(s.startMs, pxPerSec);
                  const igDurS = ig.duration ?? (sceneDurS - ig.start);
                  const x = sceneStartPx + msToPx(ig.start * 1000, pxPerSec);
                  const w = Math.max(4, msToPx(igDurS * 1000, pxPerSec));
                  const isSelected = si === sceneIdx && igi === selectedIg;
                  const igColor = ig.kind === 'stat' ? '#F59E0B' : ig.kind === 'list' ? '#10B981' : '#8B5CF6';
                  const IgIcon = ig.kind === 'stat' ? Hash : ig.kind === 'list' ? ListChecks : BarChart3;
                  const igLabel = ig.kind === 'stat' ? ig.data.value : ig.kind === 'list' ? `${ig.data.items.length} items` : `${ig.data.label}`;
                  return (
                    <div
                      key={`${si}-ig-${igi}`}
                      className="absolute cursor-grab overflow-hidden"
                      style={{
                        left: x,
                        top: 2,
                        width: Math.max(4, w - 1),
                        height: TEXT_H - 4,
                        background: isSelected
                          ? `color-mix(in srgb, ${igColor} 30%, transparent)`
                          : `color-mix(in srgb, ${igColor} 18%, transparent)`,
                        border: `1px solid color-mix(in srgb, ${igColor} ${isSelected ? 70 : 40}%, transparent)`,
                        borderRadius: 2,
                      }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'infographic', sceneIdx: si, igIdx: igi });
                        startDrag({
                          kind: 'ig-move',
                          sceneIdx: si,
                          igIdx: igi,
                          startX: e.clientX,
                          origStart: ig.start,
                        });
                      }}
                    >
                      <div className="flex items-center gap-0.5 px-1 pointer-events-none">
                        <IgIcon size={7} style={{ color: igColor, opacity: 0.9, flexShrink: 0 }} />
                        <span className="text-[8px] truncate" style={{ color: igColor }}>{igLabel}</span>
                      </div>
                      {/* Right resize handle */}
                      <div
                        className="absolute top-0 right-0 cursor-col-resize"
                        style={{ width: HANDLE_W, height: TEXT_H - 4, background: `color-mix(in srgb, ${igColor} 40%, transparent)` }}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          startDrag({
                            kind: 'ig-resize',
                            sceneIdx: si,
                            igIdx: igi,
                            startX: e.clientX,
                            origDuration: ig.duration ?? (sceneDurS - ig.start),
                            sceneDurS,
                          });
                        }}
                      />
                    </div>
                  );
                }),
              )}
            </div>

            {/* Punch beats track */}
            <div className="absolute left-0" style={{ top: punchY, height: PUNCH_H, right: 0 }}>
              {comp.scenes.map((s, si) => {
                const sceneDurS = (s.endMs - s.startMs) / 1000;
                return (s.punches ?? []).map((beat, bi) => {
                  const x = msToPx(s.startMs + beat * 1000, pxPerSec);
                  const isOob = beat >= sceneDurS;
                  return (
                    <div
                      key={`${si}-punch-${bi}`}
                      className="absolute cursor-ew-resize z-10"
                      style={{ left: x - 5, top: 2, width: 10, height: PUNCH_H - 4 }}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onSelect({ kind: 'punch', sceneIdx: si, beatIdx: bi });
                        startDrag({
                          kind: 'punch',
                          sceneIdx: si,
                          beatIdx: bi,
                          startX: e.clientX,
                          origTime: beat,
                          sceneDurS,
                        });
                      }}
                    >
                      {/* Diamond marker */}
                      <div
                        style={{
                          position: 'absolute',
                          left: '50%',
                          top: '50%',
                          width: 8,
                          height: 8,
                          transform: 'translate(-50%, -50%) rotate(45deg)',
                          background: isOob ? 'var(--destructive)' : 'var(--primary)',
                          opacity: isOob ? 0.6 : 0.85,
                          borderRadius: 1,
                        }}
                      />
                    </div>
                  );
                });
              })}
            </div>

            {/* Caption style indicator strip */}
            {hasCaptions && (
              <div className="absolute left-0 right-0" style={{ top: captionY, height: CAPTION_H }}>
                {comp.scenes.map((s) => {
                  if (!s.caption) return null;
                  const x = msToPx(s.startMs, pxPerSec);
                  const w = msToPx(s.endMs - s.startMs, pxPerSec);
                  const accent = comp.caption_style?.accent_color ?? '#FACC15';
                  return (
                    <div
                      key={s.id}
                      className="absolute rounded-sm pointer-events-none"
                      style={{
                        left: x + 1,
                        width: Math.max(2, w - 2),
                        height: CAPTION_H,
                        background: `color-mix(in srgb, ${accent} 40%, transparent)`,
                      }}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small helper: track label cell ───────────────────────────────────────────

function TrackLabel({ icon, label, h }: { icon?: React.ReactNode; label: string; h: number }) {
  return (
    <div
      className="flex items-center gap-1 px-2"
      style={{ height: h + GAP, color: 'var(--muted-foreground)' }}
    >
      {icon}
      <span style={{ fontSize: 9, lineHeight: 1 }}>{label}</span>
    </div>
  );
}
