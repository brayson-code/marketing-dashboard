'use client';

import { useMemo, useState } from 'react';
import {
  Sparkles, Users, User, UserRound, Wrench, ClipboardList, X, ArrowLeft, type LucideIcon,
} from 'lucide-react';
import {
  buildOrgGraph, neighbourhood, subtreeOf, VIEW, C,
  type OrgInput, type OrgNode, type OrgNodeKind,
} from '@/lib/org-graph';

// The Second Brain graph. Replaces the react-force-graph-2d canvas, which ran a LIVE
// d3-force simulation — perpetually solving, nudged every frame, kicked again on every
// interaction. That was the wobble. Here the layout is solved once, deterministically,
// in @/lib/org-graph, and the nodes never move.
//
// The canvas is DARK in both app themes on purpose: it's an instrument panel inset into
// a lighter product. A graph like this is unreadable on white — the edges disappear and
// the node fills stop reading as lit.
//
// Interaction, matching the reference:
//   hover  → isolate: everything outside the node's neighbourhood drops to 12%
//   click  → select: the inspector opens with the node's detail
//   click a department → drill: the wheel reduces to that department's subtree

const KIND: Record<OrgNodeKind, { label: string; Icon: LucideIcon; color: string }> = {
  self: { label: 'Notes', Icon: Sparkles, color: '#f2f2f2' },
  pillar: { label: 'Pillars', Icon: Users, color: '#10d982' },
  task: { label: 'SOP tasks', Icon: ClipboardList, color: '#8a8a9a' },
  human: { label: 'Humans', Icon: UserRound, color: '#f5a623' },
  agent: { label: 'AI agents', Icon: User, color: '#f2f2f2' },
  tool: { label: 'Tools', Icon: Wrench, color: '#ff2d3f' },
};

// Per-department hues, so a department and its agents read as one family. Falls back to
// the pillar green for anything unmapped.
const PILLAR_COLOR: Record<string, string> = {
  leadership: '#10d982',
  marketing: '#a78bfa',
  revenue: '#4c9fff',
  operations: '#2dd4bf',
  client_experience: '#f59e0b',
  unassigned: '#8a8a9a',
};

const EDGE_COLOR: Record<string, string> = {
  pillar: '#f2f2f2',
  member: '#8a8a9a',
  uses: '#ff2d3f',
  sop: '#5c5c5c',
};

const ORDER: OrgNodeKind[] = ['self', 'pillar', 'task', 'human', 'agent', 'tool'];

function colorOf(n: OrgNode): string {
  if (n.kind === 'pillar') return PILLAR_COLOR[n.pillar ?? 'unassigned'] ?? KIND.pillar.color;
  return KIND[n.kind].color;
}

export function OrgGraphView({ input, height = 620 }: { input: OrgInput; height?: number }) {
  const graph = useMemo(() => buildOrgGraph(input), [input]);
  const [hover, setHover] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [drill, setDrill] = useState<string | null>(null);

  const nodeById = useMemo(
    () => new Map(graph.nodes.map((n) => [n.id, n])),
    [graph],
  );

  // What's visible: everything, or one department's subtree when drilled in.
  const visible = useMemo(
    () => (drill ? subtreeOf(graph, drill) : null),
    [graph, drill],
  );

  // What's lit: the hovered/selected node's neighbourhood. Null = everything lit.
  const lit = useMemo(() => {
    const focus = hover ?? selected;
    return focus ? neighbourhood(graph, focus) : null;
  }, [graph, hover, selected]);

  const shown = useMemo(
    () => (visible ? graph.nodes.filter((n) => visible.has(n.id)) : graph.nodes),
    [graph, visible],
  );
  const shownEdges = useMemo(
    () => (visible
      ? graph.edges.filter((e) => visible.has(e.a) && visible.has(e.b))
      : graph.edges),
    [graph, visible],
  );

  const sel = selected ? nodeById.get(selected) ?? null : null;
  const drillNode = drill ? nodeById.get(drill) ?? null : null;

  const dimmed = (id: string) => (lit && !lit.has(id) ? 0.12 : 1);

  return (
    <div className="relative rounded-xl overflow-hidden" style={{ background: '#0a0a0f' }}>
      {/* Breadcrumb — only once you've drilled into a department. */}
      {drillNode && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-2">
          <button
            className="btn btn-sm"
            style={{ background: 'rgba(255,255,255,0.08)', color: '#f2f2f2', border: '1px solid rgba(255,255,255,0.15)' }}
            onClick={() => { setDrill(null); setSelected(null); }}
          >
            <ArrowLeft size={12} /> Back
          </button>
          <span
            className="text-xs px-2 py-1 rounded"
            style={{ background: 'rgba(255,255,255,0.06)', color: colorOf(drillNode) }}
          >
            {drillNode.label}
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${VIEW} ${VIEW}`}
        width="100%"
        height={height}
        role="img"
        aria-label={`Second Brain — ${graph.nodes.length} nodes across ${graph.counts.pillar} departments`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          {/* 44px grid, the reference's backdrop. Low contrast so it reads as depth
              rather than as content. */}
          <pattern id="og-grid" width="44" height="44" patternUnits="userSpaceOnUse">
            <path d="M 44 0 L 0 0 0 44" fill="none" stroke="#242424" strokeWidth="1" />
          </pattern>
          <radialGradient id="og-vignette" cx="50%" cy="50%" r="62%">
            <stop offset="0%" stopColor="#10d982" stopOpacity="0.05" />
            <stop offset="100%" stopColor="#10d982" stopOpacity="0" />
          </radialGradient>
        </defs>

        <rect width={VIEW} height={VIEW} fill="url(#og-grid)" opacity="0.5" />
        <rect width={VIEW} height={VIEW} fill="url(#og-vignette)" />

        {/* Ring guides — mostly-gap so they read as boundaries, not drawn circles. */}
        {!drill && [190, 330, 440].map((r) => (
          <circle
            key={r} cx={C} cy={C} r={r} fill="none"
            stroke="#242424" strokeDasharray="2 8" strokeWidth="1"
          />
        ))}

        {/* Edges first so nodes always sit on top. */}
        <g>
          {shownEdges.map((e, i) => {
            const a = nodeById.get(e.a);
            const b = nodeById.get(e.b);
            if (!a || !b) return null;
            const op = (lit && (!lit.has(e.a) || !lit.has(e.b))) ? 0.06 : 0.42;
            return (
              <line
                key={i}
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={EDGE_COLOR[e.rel]}
                strokeWidth={e.rel === 'pillar' ? 1.4 : 1}
                opacity={op}
              />
            );
          })}
        </g>

        {/* Nodes. Hierarchy is SIZE, never dimming — dimming at rest reads as
            "broken" from a zoomed-out view. Dimming here means "not in focus". */}
        <g>
          {shown.map((n) => {
            const col = colorOf(n);
            const { Icon } = KIND[n.kind];
            const isSel = n.id === selected;
            const op = dimmed(n.id);
            const glyph = Math.round(n.r * 1.05);
            const canDrill = n.kind === 'pillar';
            return (
              <g
                key={n.id}
                opacity={op}
                style={{ cursor: 'pointer', transition: 'opacity 140ms var(--ease-out, ease)' }}
                onMouseEnter={() => setHover(n.id)}
                onClick={() => {
                  if (canDrill && !drill) { setDrill(n.id); setSelected(n.id); return; }
                  setSelected(isSel ? null : n.id);
                }}
              >
                {/* Halo ring — glow with no SVG filter. */}
                <circle cx={n.x} cy={n.y} r={n.r + 5} fill="none" stroke={col} strokeWidth="1" opacity={isSel ? 0.9 : 0.28} />
                <circle cx={n.x} cy={n.y} r={n.r} fill="#0a0a0f" stroke={col} strokeWidth={isSel ? 2.4 : 1.6} />
                <Icon x={n.x - glyph / 2} y={n.y - glyph / 2} width={glyph} height={glyph} color={col} />
                {(n.kind === 'self' || n.kind === 'pillar' || isSel || hover === n.id) && (
                  <text
                    x={n.x} y={n.y + n.r + 16}
                    textAnchor="middle" fill={col} fontSize="13" fontWeight="500"
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>

      {/* Inspector — the reference's detail card. */}
      {sel && (
        <div
          className="absolute top-3 right-3 z-10 w-64 rounded-lg p-3 space-y-2"
          style={{ background: '#15151b', border: '1px solid rgba(255,255,255,0.12)' }}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate" style={{ color: '#f2f2f2' }}>{sel.label}</p>
              <p className="text-[11px]" style={{ color: '#8a8a9a' }}>{sel.meta?.type}</p>
            </div>
            <button onClick={() => setSelected(null)} aria-label="Close" style={{ color: '#8a8a9a' }}>
              <X size={13} />
            </button>
          </div>
          {sel.meta?.description && (
            <p className="text-[11px]" style={{ color: '#9c9c9c' }}>{sel.meta.description}</p>
          )}
          {sel.meta?.role && (
            <p className="text-[11px]" style={{ color: '#9c9c9c' }}>Role · {sel.meta.role}</p>
          )}
          {sel.meta?.status && (
            <p className="text-[11px]" style={{ color: '#9c9c9c' }}>Status · {sel.meta.status}</p>
          )}
          {(() => {
            const near = [...neighbourhood(graph, sel.id)]
              .filter((i) => i !== sel.id)
              .map((i) => nodeById.get(i))
              .filter((x): x is OrgNode => !!x);
            if (near.length === 0) return null;
            return (
              <div className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider" style={{ color: '#5c5c5c' }}>
                  Connected ({near.length})
                </p>
                {near.slice(0, 6).map((x) => (
                  <p key={x.id} className="text-[11px] truncate" style={{ color: '#9c9c9c' }}>{x.label}</p>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* Legend — live counts, doubling as the colour key. */}
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
    </div>
  );
}
