'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Users, User, UserRound, Wrench, ClipboardList, X, CornerUpLeft, type LucideIcon,
} from 'lucide-react';
import {
  buildOrgGraph, neighbourhood, treeLayout, VIEW, C,
  type OrgInput, type OrgNode, type OrgNodeKind,
} from '@/lib/org-graph';
import {
  frameOn, restingFrame, lerpRect, rectStr, CAM_EASE_IN, CAM_EASE_HOME, type Rect,
} from '@/lib/org-camera';

// The Second Brain graph.
//
// NODES NEVER MOVE UNDER A SIMULATION. The radial layout is solved once and
// deterministically (@/lib/org-graph). What moves is the CAMERA — a viewBox eased per
// frame — plus a scale transform on nodes near your cursor. That's the difference
// between this and the force-graph it replaced, which re-solved every frame and wobbled.
//
// Three behaviours, which together are the "peeling an onion" feel:
//   HOVER  → the node and everything one hop from it GROW and stay lit; the rest fades
//            to 12%. You can see a division's whole reach before committing to it.
//   CLICK  → the camera travels into that node (glide, 0.075/frame) and its subtree
//            re-lays as an org chart anchored on it: the node holds position and its
//            SOP tasks → agents → tools stack in tiers above it.
//   CLICK AGAIN, deeper → any lit node can be focused in turn, so you keep descending
//            without ever going "back". Background click / Escape snaps home (0.3).
//
// The easing is deliberately asymmetric — travelling in is a considered move, backing
// out is an escape.

const KIND: Record<OrgNodeKind, { label: string; Icon: LucideIcon; color: string }> = {
  self: { label: 'Notes', Icon: Sparkles, color: '#f2f2f2' },
  pillar: { label: 'Pillars', Icon: Users, color: '#10d982' },
  task: { label: 'SOP tasks', Icon: ClipboardList, color: '#8a8a9a' },
  human: { label: 'Humans', Icon: UserRound, color: '#f5a623' },
  agent: { label: 'AI agents', Icon: User, color: '#f2f2f2' },
  tool: { label: 'Tools', Icon: Wrench, color: '#ff2d3f' },
};

const PILLAR_COLOR: Record<string, string> = {
  leadership: '#10d982',
  marketing: '#a78bfa',
  revenue: '#4c9fff',
  operations: '#2dd4bf',
  client_experience: '#f59e0b',
  unassigned: '#8a8a9a',
};

const EDGE_COLOR: Record<string, string> = {
  pillar: '#f2f2f2', member: '#8a8a9a', uses: '#ff2d3f', sop: '#5c5c5c',
};

const ORDER: OrgNodeKind[] = ['self', 'pillar', 'task', 'human', 'agent', 'tool'];

function colorOf(n: OrgNode): string {
  if (n.kind === 'pillar') return PILLAR_COLOR[n.pillar ?? 'unassigned'] ?? KIND.pillar.color;
  return KIND[n.kind].color;
}

const prefersReduced = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function OrgGraphView({
  input,
  height = 620,
  centerLabel,
}: {
  input: OrgInput;
  height?: number;
  /** The founder's name or the business name — this is their brain, so it's their node. */
  centerLabel?: string;
}) {
  const graph = useMemo(
    () => buildOrgGraph(centerLabel ? { ...input, workspace: centerLabel } : input),
    [input, centerLabel],
  );
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // When a node is focused its subtree is re-laid as a tree anchored on it. Everything
  // else keeps its radial coordinates, so the branch reads as pulled forward.
  const treePos = useMemo(
    () => (focus ? treeLayout(graph, focus) : null),
    [graph, focus],
  );

  const posOf = (n: OrgNode) => treePos?.get(n.id) ?? { x: n.x, y: n.y };

  // Lit set: the focused node's neighbourhood, else the hovered node's, else everything.
  const lit = useMemo(() => {
    const id = focus ?? hover;
    return id ? neighbourhood(graph, id) : null;
  }, [graph, focus, hover]);

  // ── Camera ────────────────────────────────────────────────────────────────
  const svgRef = useRef<SVGSVGElement>(null);
  const camRef = useRef<Rect>(restingFrame(VIEW));
  const targetRef = useRef<Rect>(restingFrame(VIEW));
  const easeRef = useRef<number>(CAM_EASE_IN);

  useEffect(() => {
    if (focus) {
      const n = nodeById.get(focus);
      if (n) {
        const p = treePos?.get(focus) ?? { x: n.x, y: n.y };
        // Frame ABOVE the focused node: its tree stacks upward, so centring on the node
        // itself would put the branch off-screen.
        targetRef.current = frameOn(VIEW, p.x, p.y - 210, n.kind === 'pillar' ? 0.62 : 0.4);
        easeRef.current = CAM_EASE_IN;
      }
    } else {
      targetRef.current = restingFrame(VIEW);
      easeRef.current = CAM_EASE_HOME; // backing out is a snap, not a cruise
    }
  }, [focus, nodeById, treePos]);

  useEffect(() => {
    const reduced = prefersReduced();
    let raf = 0;
    const step = () => {
      const next = lerpRect(camRef.current, targetRef.current, reduced ? 1 : easeRef.current);
      // Skip the DOM write when nothing changed — rewriting an identical viewBox
      // invalidates the whole subtree's paint every frame for no reason.
      if (
        next.x !== camRef.current.x || next.y !== camRef.current.y
        || next.w !== camRef.current.w || next.h !== camRef.current.h
      ) {
        camRef.current = next;
        svgRef.current?.setAttribute('viewBox', rectStr(next));
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFocus(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const focusNode = focus ? nodeById.get(focus) ?? null : null;

  // Scale: the focused node and its neighbours grow. This is the "they appear larger"
  // behaviour — hierarchy reads through SIZE, which survives being zoomed out, where
  // dimming alone just looks broken.
  const scaleOf = (n: OrgNode) => {
    if (n.id === focus) return 1.45;
    if (!lit) return 1;
    if (!lit.has(n.id)) return 0.88;
    return 1.3;
  };
  const opacityOf = (n: OrgNode) => (lit && !lit.has(n.id) ? 0.12 : 1);

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ background: '#0a0a0f' }}>
      {focusNode && (
        <button
          className="absolute top-3 left-3 z-10 btn btn-sm"
          style={{ background: 'rgba(255,255,255,0.08)', color: '#f2f2f2', border: '1px solid rgba(255,255,255,0.15)' }}
          onClick={() => setFocus(null)}
        >
          <CornerUpLeft size={12} /> {focusNode.label}
        </button>
      )}

      <svg
        ref={svgRef}
        viewBox={rectStr(restingFrame(VIEW))}
        width="100%"
        height={height}
        role="img"
        aria-label={`Second Brain — ${graph.nodes.length} nodes across ${graph.counts.pillar} departments`}
        onMouseLeave={() => setHover(null)}
        onClick={() => setFocus(null)}
      >
        <defs>
          <pattern id="og-grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#242424" strokeWidth="1" />
          </pattern>
          <radialGradient id="og-vignette" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor="#10d982" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#10d982" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect x={-VIEW} y={-VIEW} width={VIEW * 3} height={VIEW * 3} fill="url(#og-grid)" opacity="0.5" />
        <rect x={-VIEW} y={-VIEW} width={VIEW * 3} height={VIEW * 3} fill="url(#og-vignette)" />

        {!focus && [190, 330, 440].map((r) => (
          <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="#242424" strokeDasharray="2 8" strokeWidth="1" />
        ))}

        <g>
          {graph.edges.map((e, i) => {
            const a = nodeById.get(e.a);
            const b = nodeById.get(e.b);
            if (!a || !b) return null;
            const pa = posOf(a);
            const pb = posOf(b);
            const off = lit && (!lit.has(e.a) || !lit.has(e.b));
            return (
              <line
                key={i}
                x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                stroke={EDGE_COLOR[e.rel]}
                strokeWidth={e.rel === 'pillar' ? 1.4 : 1}
                opacity={off ? 0.05 : 0.45}
                style={{ transition: 'opacity 200ms ease, x1 420ms var(--ease-out, ease), y1 420ms var(--ease-out, ease), x2 420ms var(--ease-out, ease), y2 420ms var(--ease-out, ease)' }}
              />
            );
          })}
        </g>

        <g>
          {graph.nodes.map((n) => {
            const col = colorOf(n);
            const { Icon } = KIND[n.kind];
            const p = posOf(n);
            const s = scaleOf(n);
            const isLit = !lit || lit.has(n.id);
            const showLabel = n.kind === 'self' || n.kind === 'pillar' || isLit && (hover === n.id || focus === n.id || !!focus);
            const glyph = Math.round(n.r * 1.05);
            return (
              <g
                key={n.id}
                transform={`translate(${p.x} ${p.y})`}
                opacity={opacityOf(n)}
                style={{
                  cursor: 'pointer',
                  transition: 'opacity 200ms ease, transform 420ms var(--ease-out, ease)',
                }}
                onMouseEnter={() => setHover(n.id)}
                onClick={(ev) => { ev.stopPropagation(); setFocus(n.id === focus ? null : n.id); }}
              >
                {/* Inner group carries the scale so the growth animates around the
                    node's own centre rather than the SVG origin. */}
                <g style={{ transform: `scale(${s})`, transition: 'transform 260ms var(--ease-out, ease)' }}>
                  <circle r={n.r + 5} fill="none" stroke={col} strokeWidth="1" opacity={n.id === focus ? 0.95 : 0.28} />
                  <circle r={n.r} fill="#0a0a0f" stroke={col} strokeWidth={n.id === focus ? 2.6 : 1.6} />
                  <Icon x={-glyph / 2} y={-glyph / 2} width={glyph} height={glyph} color={col} />
                </g>
                {showLabel && (
                  <text
                    y={n.r * s + 17}
                    textAnchor="middle" fill={col} fontSize="13" fontWeight="500"
                    style={{ pointerEvents: 'none' }}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      <div
        className="absolute bottom-3 left-3 z-10 rounded-lg px-3 py-2 space-y-1"
        style={{ background: 'rgba(10,10,15,0.85)', border: '1px solid rgba(255,255,255,0.1)' }}
      >
        {ORDER.map((k) => {
          const { label, Icon, color } = KIND[k];
          return (
            <div key={k} className="flex items-center gap-2 text-[11px]" style={{ color: '#9c9c9c' }}>
              <Icon size={11} color={color} />
              <span className="flex-1">{label}</span>
              <span style={{ color: '#5c5c5c' }}>{graph.counts[k]}</span>
            </div>
          );
        })}
      </div>

      {focusNode && (
        <div
          className="absolute bottom-3 right-3 z-10 rounded-lg px-3 py-2 max-w-[260px]"
          style={{ background: '#15151b', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: colorOf(focusNode) }}>{focusNode.label}</p>
              <p className="text-[11px]" style={{ color: '#8a8a9a' }}>{focusNode.meta?.type}</p>
            </div>
            <button onClick={() => setFocus(null)} aria-label="Close" style={{ color: '#8a8a9a' }}>
              <X size={13} />
            </button>
          </div>
          {focusNode.meta?.description && (
            <p className="text-[11px] mt-1" style={{ color: '#9c9c9c' }}>{focusNode.meta.description}</p>
          )}
          <p className="text-[10px] mt-1.5" style={{ color: '#5c5c5c' }}>
            Click any lit node to go deeper · Esc to pull back
          </p>
        </div>
      )}
    </div>
  );
}
