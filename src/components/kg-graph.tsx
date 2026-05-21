'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface KgGraphEntity {
  id: number;
  kind: string;
  name: string;
  attributes?: Record<string, unknown>;
}

export interface KgGraphRelation {
  from_id: number;
  to_id: number;
  label: string;
}

interface KnowledgeGraphProps {
  entities: KgGraphEntity[];
  relations: KgGraphRelation[];
  compact?: boolean;
  onSelect?: (id: number) => void;
}

// Palette keyed by entity kind. Falls back to a neutral accent.
const KIND_COLORS: Record<string, string> = {
  company: '#3b82f6',
  person: '#22c55e',
  topic: '#f59e0b',
  product: '#8b5cf6',
  lead: '#ec4899',
  goal: '#ef4444',
  campaign: '#06b6d4',
  channel: '#14b8a6',
  agent: '#a855f7',
};
const FALLBACK_COLOR = '#94a3b8';
const colorForKind = (kind: string) => KIND_COLORS[kind?.toLowerCase()] ?? FALLBACK_COLOR;
const truncate = (s: string, max: number) => (s.length <= max ? s : s.slice(0, max - 1) + '…');

interface SimNode { id: number; x: number; y: number; vx: number; vy: number; }

export default function KnowledgeGraph({ entities, relations, compact = false, onSelect }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 640, h: compact ? 220 : 480 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const nodes = useRef<Map<number, SimNode>>(new Map());
  const [, forceRender] = useState(0);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });

  // Mutable state the rAF loop reads (avoids stale closures).
  const sim = useRef({ edges: [] as KgGraphRelation[], w: 640, h: 480, dragId: null as number | null, raf: 0, ticks: 0, running: false, compact });

  const validRelations = useMemo(
    () => relations.filter((r) => entities.some((e) => e.id === r.from_id) && entities.some((e) => e.id === r.to_id)),
    [relations, entities],
  );

  const connectedIds = useMemo(() => {
    if (hoverId === null) return null;
    const set = new Set<number>([hoverId]);
    validRelations.forEach((r) => {
      if (r.from_id === hoverId) set.add(r.to_id);
      if (r.to_id === hoverId) set.add(r.from_id);
    });
    return set;
  }, [hoverId, validRelations]);

  sim.current.edges = validRelations;
  sim.current.w = size.w;
  sim.current.h = size.h;
  sim.current.compact = compact;

  const kick = useCallback(() => {
    const s = sim.current;
    s.ticks = 0;
    if (s.running) return;
    s.running = true;
    const tick = () => {
      const { w, h, edges, dragId, compact: cmp } = sim.current;
      const cx = w / 2, cy = h / 2;
      const REST = cmp ? 64 : 96;
      const REPULSION = cmp ? 2600 : 6000;
      const CENTER = 0.016;
      const DAMP = 0.85;
      const list = [...nodes.current.values()];
      const fx = new Map<number, number>(), fy = new Map<number, number>();
      list.forEach((n) => { fx.set(n.id, 0); fy.set(n.id, 0); });
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i], b = list[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy; if (d2 < 1) d2 = 1;
          const d = Math.sqrt(d2), f = REPULSION / d2;
          const ux = dx / d, uy = dy / d;
          fx.set(a.id, fx.get(a.id)! + ux * f); fy.set(a.id, fy.get(a.id)! + uy * f);
          fx.set(b.id, fx.get(b.id)! - ux * f); fy.set(b.id, fy.get(b.id)! - uy * f);
        }
      }
      edges.forEach((r) => {
        const a = nodes.current.get(r.from_id), b = nodes.current.get(r.to_id);
        if (!a || !b) return;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const k = ((d - REST) / d) * 0.06;
        fx.set(a.id, fx.get(a.id)! + dx * k); fy.set(a.id, fy.get(a.id)! + dy * k);
        fx.set(b.id, fx.get(b.id)! - dx * k); fy.set(b.id, fy.get(b.id)! - dy * k);
      });
      let energy = 0;
      list.forEach((n) => {
        if (dragId === n.id) { n.vx = 0; n.vy = 0; return; }
        const ax = fx.get(n.id)! + (cx - n.x) * CENTER;
        const ay = fy.get(n.id)! + (cy - n.y) * CENTER;
        n.vx = (n.vx + ax) * DAMP; n.vy = (n.vy + ay) * DAMP;
        n.x += Math.max(-25, Math.min(25, n.vx));
        n.y += Math.max(-25, Math.min(25, n.vy));
        n.x = Math.max(24, Math.min(w - 24, n.x));
        n.y = Math.max(24, Math.min(h - 24, n.y));
        energy += n.vx * n.vx + n.vy * n.vy;
      });
      forceRender((t) => t + 1);
      sim.current.ticks++;
      if ((energy > 0.04 || dragId !== null) && sim.current.ticks < 1200) {
        sim.current.raf = requestAnimationFrame(tick);
      } else {
        sim.current.running = false;
      }
    };
    sim.current.raf = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((ents) => {
      const w = ents[0].contentRect.width;
      if (w > 0) setSize({ w: Math.max(220, Math.round(w)), h: compact ? 220 : 480 });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [compact]);

  useEffect(() => {
    const { w, h } = sim.current;
    const cx = w / 2, cy = h / 2;
    const n = entities.length;
    const next = new Map<number, SimNode>();
    entities.forEach((e, i) => {
      const prev = nodes.current.get(e.id);
      if (prev) next.set(e.id, prev);
      else {
        const angle = (i / Math.max(1, n)) * Math.PI * 2;
        const r = Math.min(w, h) / 3.2;
        next.set(e.id, { id: e.id, x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 });
      }
    });
    nodes.current = next;
    kick();
  }, [entities, size.w, size.h, kick]);

  useEffect(() => () => { if (sim.current.raf) cancelAnimationFrame(sim.current.raf); }, []);

  // Zoom: Shift + scroll only (plain scroll lets the page scroll normally). Native
  // non-passive listener so we can preventDefault without React's passive default.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || compact) return;
    const handler = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // no modifier → page scrolls, graph stays put
      e.preventDefault(); // also suppresses the browser's ctrl+scroll zoom
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      const factor = delta < 0 ? 1.12 : 1 / 1.12;
      const rect = svg.getBoundingClientRect();
      const ux = ((e.clientX - rect.left) / rect.width) * sizeRef.current.w;
      const uy = ((e.clientY - rect.top) / rect.height) * sizeRef.current.h;
      setView((v) => {
        const k = Math.max(0.4, Math.min(3, v.k * factor));
        return { k, x: ux - ((ux - v.x) / v.k) * k, y: uy - ((uy - v.y) / v.k) * k };
      });
    };
    svg.addEventListener('wheel', handler, { passive: false });
    return () => svg.removeEventListener('wheel', handler);
  }, [compact]);

  const toGraph = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const ux = ((clientX - rect.left) / rect.width) * size.w;
    const uy = ((clientY - rect.top) / rect.height) * size.h;
    return { x: (ux - view.x) / view.k, y: (uy - view.y) / view.k };
  }, [size.w, size.h, view]);

  const drag = useRef<{ id: number | null; moved: boolean; panX: number; panY: number; startX: number; startY: number; panning: boolean }>(
    { id: null, moved: false, panX: 0, panY: 0, startX: 0, startY: 0, panning: false },
  );

  const onNodePointerDown = (id: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { ...drag.current, id, moved: false, startX: e.clientX, startY: e.clientY };
    sim.current.dragId = id;
    kick();
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d.id !== null) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > 3) d.moved = true;
      const g = toGraph(e.clientX, e.clientY);
      const node = nodes.current.get(d.id);
      if (node) { node.x = g.x; node.y = g.y; node.vx = 0; node.vy = 0; }
      kick();
    } else if (d.panning && !compact) {
      setView((v) => ({ ...v, x: d.panX + (e.clientX - d.startX), y: d.panY + (e.clientY - d.startY) }));
    }
  };
  const endPointer = () => {
    const d = drag.current;
    if (d.id !== null && !d.moved && onSelect) onSelect(d.id);
    drag.current = { ...d, id: null, panning: false };
    sim.current.dragId = null;
    kick();
  };
  // Pan: Shift + drag the background (prevents accidental "surfing" on a normal click-drag).
  const onBgPointerDown = (e: React.PointerEvent) => {
    if (compact || (!e.ctrlKey && !e.metaKey)) return;
    drag.current = { ...drag.current, panning: true, startX: e.clientX, startY: e.clientY, panX: view.x, panY: view.y };
  };

  if (entities.length === 0) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground rounded-lg"
        style={{ minHeight: compact ? 220 : 360, border: '1px dashed var(--border)' }}>
        No graph yet
      </div>
    );
  }

  const nodeR = compact ? 9 : 13;
  const hoverR = compact ? 12 : 17;

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <svg
        ref={svgRef}
        width="100%"
        height={size.h}
        viewBox={`0 0 ${size.w} ${size.h}`}
        onPointerDown={onBgPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerLeave={endPointer}
        style={{
          display: 'block', background: 'var(--card)', borderRadius: 'var(--radius)',
          border: '1px solid var(--border)', touchAction: 'none',
          cursor: drag.current.panning ? 'grabbing' : 'default',
        }}
      >
        <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
          {validRelations.map((r, i) => {
            const a = nodes.current.get(r.from_id), b = nodes.current.get(r.to_id);
            if (!a || !b) return null;
            const active = connectedIds !== null && connectedIds.has(r.from_id) && connectedIds.has(r.to_id);
            const dimmed = connectedIds !== null && !active;
            return (
              <g key={`e-${i}`} opacity={dimmed ? 0.12 : 1}>
                <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke={active ? 'var(--primary)' : 'var(--border)'} strokeWidth={active ? 2.5 : 1.4} />
                {!compact && (
                  <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 3} textAnchor="middle"
                    fill="var(--muted-foreground)" fontSize={9} style={{ pointerEvents: 'none' }}>
                    {truncate(r.label, 16)}
                  </text>
                )}
              </g>
            );
          })}
          {entities.map((e) => {
            const p = nodes.current.get(e.id);
            if (!p) return null;
            const color = colorForKind(e.kind);
            const isHover = hoverId === e.id;
            const dimmed = connectedIds !== null && !connectedIds.has(e.id);
            const r = isHover ? hoverR : nodeR;
            return (
              <g key={`n-${e.id}`} opacity={dimmed ? 0.28 : 1}
                style={{ cursor: 'grab' }}
                onPointerDown={onNodePointerDown(e.id)}
                onPointerEnter={() => setHoverId(e.id)}
                onPointerLeave={() => setHoverId((h) => (h === e.id ? null : h))}
              >
                <circle cx={p.x} cy={p.y} r={r * 2.1} fill={color} opacity={isHover ? 0.28 : 0.16} />
                <circle cx={p.x} cy={p.y} r={r} fill={color}
                  stroke={isHover ? 'var(--foreground)' : 'var(--card)'} strokeWidth={isHover ? 2.5 : 2} />
                <text x={p.x} y={p.y} textAnchor="middle" dominantBaseline="central"
                  fill="#fff" fontSize={r} fontWeight={700} style={{ pointerEvents: 'none' }}>
                  {e.name.charAt(0).toUpperCase()}
                </text>
                <text x={p.x} y={p.y + r + 12} textAnchor="middle"
                  fill="var(--foreground)" fontSize={compact ? 10 : 12} fontWeight={isHover ? 600 : 400}
                  style={{ pointerEvents: 'none' }}>
                  {truncate(e.name, compact ? 12 : 18)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {!compact && (
        <>
          {/* Controls legend */}
          <div className="absolute top-2 left-2 rounded-lg bg-[var(--card)]/90 border border-[var(--border)] px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground backdrop-blur-sm pointer-events-none select-none">
            <div className="font-semibold text-[var(--foreground)] mb-1">Graph controls</div>
            <div><b className="text-[var(--foreground)]">Drag</b> a node — reposition it</div>
            <div><Kbd>Ctrl</Kbd> + drag — pan around</div>
            <div><Kbd>Ctrl</Kbd> + scroll — zoom in/out</div>
            <div><b className="text-[var(--foreground)]">Hover</b> — highlight links · <b className="text-[var(--foreground)]">Click</b> — details</div>
          </div>
          {/* Reset view */}
          <button
            onClick={() => setView({ x: 0, y: 0, k: 1 })}
            className="absolute top-2 right-2 rounded-md bg-[var(--card)]/90 border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-[var(--foreground)] backdrop-blur-sm"
          >
            Reset view
          </button>
        </>
      )}
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-block rounded border border-[var(--border)] bg-[var(--muted)] px-1 font-mono text-[9px] text-[var(--foreground)]">
      {children}
    </kbd>
  );
}
