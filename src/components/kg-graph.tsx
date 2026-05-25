'use client';

// Knowledge-graph renderer backed by react-force-graph-2d (canvas + d3-force).
// Replaces the previous hand-rolled SVG sim that re-rendered the whole React tree
// every animation frame (O(n²) + 60fps reconciliation = jank). The physics + pan/
// zoom/drag now run on canvas with no React re-render per tick. Same public API.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ForceGraphMethods, NodeObject, LinkObject } from 'react-force-graph-2d';

// Canvas lib touches window/document at import → load client-only via a wrapper
// that forwards the instance through a `graphRef` prop (next/dynamic doesn't
// forward refs, so zoomToFit() needs this indirection). Typed loosely here; our
// own callbacks below stay strongly typed against GNode/GLink.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ForceGraph2D = dynamic(() => import('./kg-force-graph'), { ssr: false }) as any;

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

interface GNode extends NodeObject {
  id: number;
  name: string;
  kind: string;
}
interface GLink extends LinkObject {
  source: number | GNode;
  target: number | GNode;
  label: string;
}

// Resolve a CSS custom property to a concrete color the canvas can use (canvas
// can't read `var(--x)`). Falls back to a sensible default for SSR/first paint.
function cssVar(name: string, fallback: string): string {
  if (typeof window === 'undefined') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export default function KnowledgeGraph({ entities, relations, compact = false, onSelect }: KnowledgeGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphMethods<GNode, GLink> | undefined>(undefined);
  const height = compact ? 220 : 480;
  const [width, setWidth] = useState(640);
  const [hoverId, setHoverId] = useState<number | null>(null);

  // Theme colors resolved from CSS vars (re-read on mount; cheap).
  const [theme, setTheme] = useState({ border: '#2a2a2a', fg: '#e5e5e5', card: '#111', primary: '#6366f1', muted: '#888' });
  useEffect(() => {
    setTheme({
      border: cssVar('--border', '#2a2a2a'),
      fg: cssVar('--foreground', '#e5e5e5'),
      card: cssVar('--card', '#111'),
      primary: cssVar('--primary', '#6366f1'),
      muted: cssVar('--muted-foreground', '#888'),
    });
  }, []);

  // Content signature: only the actual entities/relations matter, not array
  // identity. The /kg page re-fetches every 5s and hands us fresh arrays with
  // identical content; without this guard force-graph would re-run its whole
  // simulation each poll and never settle/center. We rebuild graphData (and let
  // force-graph re-layout) ONLY when this signature changes.
  const sig = useMemo(
    () =>
      entities.map((e) => `${e.id}:${e.kind}:${e.name}`).join('|') +
      '::' +
      relations.map((r) => `${r.from_id}-${r.to_id}-${r.label}`).join('|'),
    [entities, relations],
  );
  const cache = useRef<{ sig: string; data: { nodes: GNode[]; links: GLink[] } }>({ sig: '', data: { nodes: [], links: [] } });
  const graphData = useMemo(() => {
    if (cache.current.sig === sig && cache.current.data.nodes.length > 0) return cache.current.data; // unchanged → keep warm positions
    const ids = new Set(entities.map((e) => e.id));
    const nodes: GNode[] = entities.map((e) => ({ id: e.id, name: e.name, kind: e.kind }));
    const links: GLink[] = relations
      .filter((r) => ids.has(r.from_id) && ids.has(r.to_id))
      .map((r) => ({ source: r.from_id, target: r.to_id, label: r.label }));
    const data = { nodes, links };
    cache.current = { sig, data };
    return data;
  }, [sig, entities, relations]);

  // Adjacency for hover highlighting (neighbors + incident edges stay lit).
  const neighbors = useMemo(() => {
    const m = new Map<number, Set<number>>();
    for (const l of graphData.links) {
      const s = typeof l.source === 'object' ? l.source.id : l.source;
      const t = typeof l.target === 'object' ? l.target.id : l.target;
      if (!m.has(s)) m.set(s, new Set());
      if (!m.has(t)) m.set(t, new Set());
      m.get(s)!.add(t);
      m.get(t)!.add(s);
    }
    return m;
  }, [graphData]);

  const isLit = useCallback(
    (id: number) => hoverId === null || id === hoverId || (neighbors.get(hoverId)?.has(id) ?? false),
    [hoverId, neighbors],
  );

  // Track container width so the canvas fills the panel responsively.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((ents) => {
      const w = ents[0].contentRect.width;
      if (w > 0) setWidth(Math.max(220, Math.round(w)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the graph to the viewport once it settles.
  const onEngineStop = useCallback(() => {
    fgRef.current?.zoomToFit(400, compact ? 16 : 48);
  }, [compact]);

  // Re-center whenever the data or the canvas size changes. A single onEngineStop
  // fit can be stale: data arrives async, and the ResizeObserver bumps `width` after
  // the first layout — leaving the graph off-center/clipped. This re-fits after the
  // layout has had a moment to settle, so the WHOLE graph stays centered in view.
  useEffect(() => {
    if (graphData.nodes.length === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit(400, compact ? 16 : 48), 400);
    return () => clearTimeout(t);
  }, [graphData, width, height, compact]);

  const nodeR = compact ? 4 : 6;

  // Draw each node: kind-colored disc + soft glow + initial glyph + name label.
  const drawNode = useCallback(
    (node: GNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const lit = isLit(node.id);
      const hovered = hoverId === node.id;
      const color = colorForKind(node.kind);
      const r = hovered ? nodeR * 1.3 : nodeR;
      ctx.globalAlpha = lit ? 1 : 0.25;

      // glow
      ctx.beginPath();
      ctx.arc(x, y, r * 2.1, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.globalAlpha = (lit ? 1 : 0.25) * (hovered ? 0.28 : 0.16);
      ctx.fill();

      // disc
      ctx.globalAlpha = lit ? 1 : 0.25;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.lineWidth = (hovered ? 1.6 : 1.2) / globalScale;
      ctx.strokeStyle = hovered ? theme.fg : theme.card;
      ctx.stroke();

      // initial glyph
      const glyph = node.name.charAt(0).toUpperCase();
      ctx.font = `700 ${r * 1.1}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.fillText(glyph, x, y);

      // name label (skip when zoomed far out to reduce clutter)
      if (globalScale > 0.6 || hovered) {
        const fontSize = (compact ? 10 : 12) / globalScale;
        ctx.font = `${hovered ? 600 : 400} ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillStyle = theme.fg;
        ctx.fillText(truncate(node.name, compact ? 12 : 18), x, y + r + fontSize);
      }
      ctx.globalAlpha = 1;
    },
    [isLit, hoverId, nodeR, theme, compact],
  );

  // Bigger invisible hit area so custom-drawn nodes are easy to click/hover.
  const drawNodePointerArea = useCallback(
    (node: GNode, color: string, ctx: CanvasRenderingContext2D) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, nodeR * 1.6, 0, Math.PI * 2);
      ctx.fill();
    },
    [nodeR],
  );

  const linkColor = useCallback(
    (link: GLink) => {
      const s = typeof link.source === 'object' ? link.source.id : link.source;
      const t = typeof link.target === 'object' ? link.target.id : link.target;
      if (hoverId !== null && (s === hoverId || t === hoverId)) return theme.primary;
      return theme.border;
    },
    [hoverId, theme],
  );

  if (entities.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-xs text-muted-foreground rounded-lg"
        style={{ minHeight: compact ? 220 : 360, border: '1px dashed var(--border)' }}
      >
        No graph yet
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ width: '100%', position: 'relative' }}>
      <div style={{ borderRadius: 'var(--radius)', border: '1px solid var(--border)', background: 'var(--card)', overflow: 'hidden' }}>
        <ForceGraph2D
          graphRef={fgRef}
          graphData={graphData}
          width={width}
          height={height}
          backgroundColor="rgba(0,0,0,0)"
          nodeRelSize={nodeR}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={drawNodePointerArea}
          linkColor={linkColor}
          linkWidth={(l: GLink) => {
            const s = typeof l.source === 'object' ? l.source.id : l.source;
            const t = typeof l.target === 'object' ? l.target.id : l.target;
            return hoverId !== null && (s === hoverId || t === hoverId) ? 2.2 : 1.2;
          }}
          linkLabel={(l: GLink) => l.label}
          linkDirectionalParticles={0}
          cooldownTicks={compact ? 60 : 120}
          onEngineStop={onEngineStop}
          onNodeHover={(n: GNode | null) => setHoverId(n ? n.id : null)}
          onNodeClick={(n: GNode) => onSelect?.(n.id)}
          enableZoomInteraction={true}
          enablePanInteraction={true}
          enableNodeDrag={true}
        />
      </div>

      {!compact && (
        <>
          <div className="absolute top-2 left-2 rounded-lg bg-[var(--card)]/90 border border-[var(--border)] px-2.5 py-2 text-[10px] leading-relaxed text-muted-foreground backdrop-blur-sm pointer-events-none select-none">
            <div className="font-semibold text-[var(--foreground)] mb-1">Graph controls</div>
            <div><b className="text-[var(--foreground)]">Drag</b> a node — reposition it</div>
            <div><b className="text-[var(--foreground)]">Drag</b> background — pan · <b className="text-[var(--foreground)]">Scroll</b> — zoom</div>
            <div><b className="text-[var(--foreground)]">Hover</b> — highlight links · <b className="text-[var(--foreground)]">Click</b> — details</div>
          </div>
          <button
            onClick={() => fgRef.current?.zoomToFit(400, 40)}
            className="absolute top-2 right-2 rounded-md bg-[var(--card)]/90 border border-[var(--border)] px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-[var(--foreground)] backdrop-blur-sm"
          >
            Reset view
          </button>
        </>
      )}
    </div>
  );
}
