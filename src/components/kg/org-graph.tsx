'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Sparkles, Users, User, UserRound, Wrench, ClipboardList, X, CornerUpLeft,
  Target, FileText, Contact, Lightbulb, Maximize2, type LucideIcon,
} from 'lucide-react';
import {
  buildOrgGraph, neighbourhood, treeLayout, hashId, VIEW, C,
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
  self: { label: 'Founder', Icon: Sparkles, color: '#f2f2f2' },
  pillar: { label: 'Areas', Icon: Users, color: '#10d982' },
  task: { label: 'SOP tasks', Icon: ClipboardList, color: '#8a8a9a' },
  human: { label: 'Humans', Icon: UserRound, color: '#f5a623' },
  agent: { label: 'AI agents', Icon: User, color: '#f2f2f2' },
  tool: { label: 'Tools', Icon: Wrench, color: '#ff2d3f' },
  goal: { label: 'Goals', Icon: Target, color: '#10d982' },
  file: { label: 'Files', Icon: FileText, color: '#8ab4f8' },
  contact: { label: 'Contacts', Icon: Contact, color: '#2dd4bf' },
  note: { label: 'Knowledge', Icon: Lightbulb, color: '#c9b6ff' },
};

const PILLAR_COLOR: Record<string, string> = {
  leadership: '#10d982',
  marketing: '#a78bfa',
  revenue: '#4c9fff',
  operations: '#2dd4bf',
  client_experience: '#f59e0b',
  unassigned: '#8a8a9a',
  // The non-department areas take their own hue so a hub reads as "an area of the
  // business" rather than "another department".
  goals: '#10d982',
  files: '#8ab4f8',
  contacts: '#2dd4bf',
  knowledge: '#c9b6ff',
};

const EDGE_COLOR: Record<string, string> = {
  pillar: '#f2f2f2', member: '#8a8a9a', uses: '#ff2d3f', sop: '#5c5c5c',
};

const ORDER: OrgNodeKind[] = ['self', 'pillar', 'agent', 'human', 'tool', 'goal', 'file', 'contact', 'note', 'task'];

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
  onSelect,
}: {
  input: OrgInput;
  height?: number;
  /** The founder's name or the business name — this is their brain, so it's their node. */
  centerLabel?: string;
  /** Fired on selection so the page can show what you're looking at underneath the
   *  graph. Null when the selection is cleared. */
  onSelect?: (node: OrgNode | null) => void;
}) {
  const graph = useMemo(
    () => buildOrgGraph(centerLabel ? { ...input, workspace: centerLabel } : input),
    [input, centerLabel],
  );
  const [hover, setHover] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  // Filter for the full-contents list on an area hub. A workspace with 656 knowledge
  // entries needs a way to find one, not just to scroll past 656.
  const [areaFilter, setAreaFilter] = useState('');

  const nodeById = useMemo(() => new Map(graph.nodes.map((n) => [n.id, n])), [graph]);

  // When a node is focused its subtree is re-laid as a tree anchored on it. Everything
  // else keeps its radial coordinates, so the branch reads as pulled forward.
  const treePos = useMemo(
    () => (focus ? treeLayout(graph, focus) : null),
    [graph, focus],
  );

  // Manual node positions. The layout is still solved once and deterministically —
  // this is an OVERRIDE on top, so dragging a node to somewhere it reads better is
  // remembered without reintroducing a live simulation.
  const [moved, setMoved] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDragRef = useRef<{ id: string; ox: number; oy: number; sx: number; sy: number } | null>(null);

  const posOf = (n: OrgNode) =>
    moved[n.id] ?? treePos?.get(n.id) ?? { x: n.x, y: n.y };

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

  // ── Pan + zoom ────────────────────────────────────────────────────────────
  // Without this, anything the auto-framing doesn't happen to cover is simply
  // unreachable — you can see half the graph and have no way to get to the rest.
  // Dragging writes to BOTH cam and target so the easing loop doesn't fight the
  // pointer and drag the view back out from under you.
  const dragRef = useRef<{ x: number; y: number; cam: Rect } | null>(null);
  const [dragging, setDragging] = useState(false);

  const unitsPerPx = () => {
    const el = svgRef.current;
    const w = el?.clientWidth || 1;
    return camRef.current.w / w;
  };

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    // Left button only; let other buttons through for native behaviours.
    if (e.button !== 0) return;
    dragRef.current = { x: e.clientX, y: e.clientY, cam: { ...camRef.current } };
    setDragging(true);
    (e.currentTarget as SVGSVGElement).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const k = unitsPerPx();
    const next: Rect = {
      x: d.cam.x - (e.clientX - d.x) * k,
      y: d.cam.y - (e.clientY - d.y) * k,
      w: d.cam.w,
      h: d.cam.h,
    };
    camRef.current = next;
    targetRef.current = next;
    svgRef.current?.setAttribute('viewBox', rectStr(next));
  };

  const endDrag = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!dragRef.current) return;
    const moved = Math.hypot(e.clientX - dragRef.current.x, e.clientY - dragRef.current.y);
    dragRef.current = null;
    setDragging(false);
    // A drag must not also register as a click — otherwise panning the canvas
    // constantly throws you out of whatever you were focused on.
    if (moved > 4) suppressClickRef.current = true;
  };

  const suppressClickRef = useRef(false);

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const el = svgRef.current;
    if (!el) return;
    const cam = camRef.current;
    const factor = e.deltaY > 0 ? 1.12 : 1 / 1.12;
    // Clamped so you can't zoom to a pinhead or lose the graph entirely.
    const w = Math.max(VIEW * 0.12, Math.min(VIEW * 2.2, cam.w * factor));
    const h = w;
    // Zoom toward the cursor rather than the centre, which is what makes a wheel
    // zoom feel like it's obeying you.
    const rect = el.getBoundingClientRect();
    const px = (e.clientX - rect.left) / (rect.width || 1);
    const py = (e.clientY - rect.top) / (rect.height || 1);
    const next: Rect = {
      x: cam.x + (cam.w - w) * px,
      y: cam.y + (cam.h - h) * py,
      w, h,
    };
    camRef.current = next;
    targetRef.current = next;
    el.setAttribute('viewBox', rectStr(next));
  };

  const resetView = () => {
    setFocus(null);
    setMoved({});
    targetRef.current = restingFrame(VIEW);
    easeRef.current = CAM_EASE_HOME;
  };

  const focusNode = focus ? nodeById.get(focus) ?? null : null;

  // The FULL contents of an area hub, straight from the props the graph was built from.
  // buildOrgGraph only draws AREA_CAP of these; the rest were unreachable before.
  const areaItems = useMemo(() => {
    if (!focusNode || !focusNode.id.startsWith('area:')) return null;
    const key = focusNode.id.slice('area:'.length);
    const byKey: Record<string, ReadonlyArray<{ id: string; name: string; status?: string }>> = {
      goals: input.goals ?? [],
      files: input.files ?? [],
      contacts: input.contacts ?? [],
      knowledge: input.notes ?? [],
    };
    return byKey[key] ?? null;
  }, [focusNode, input]);

  // Mirrors AREA_PILLARS in org-graph.ts — the node kind each area's leaves are built
  // with. Needed to find a drawn node by id and to build a matching synthetic one.
  const areaKind: OrgNodeKind | null = useMemo(() => {
    if (!focusNode || !focusNode.id.startsWith('area:')) return null;
    const map: Record<string, OrgNodeKind> = {
      goals: 'goal', files: 'file', contacts: 'contact', knowledge: 'note',
    };
    return map[focusNode.id.slice('area:'.length)] ?? null;
  }, [focusNode]);

  const visibleAreaItems = useMemo(() => {
    if (!areaItems) return [];
    const q = areaFilter.trim().toLowerCase();
    const matched = q ? areaItems.filter((i) => i.name.toLowerCase().includes(q)) : areaItems;
    // Cap the RENDERED rows, not the searchable set: 656 buttons in the DOM is a
    // scroll-jank problem, while filtering down to what you want is not.
    return matched.slice(0, 200);
  }, [areaItems, areaFilter]);

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
      <button
        className="absolute top-3 right-3 z-10 btn btn-sm"
        style={{ background: 'rgba(255,255,255,0.08)', color: '#f2f2f2', border: '1px solid rgba(255,255,255,0.15)' }}
        onClick={resetView}
        title="Reset the view"
      >
        <Maximize2 size={12} /> Reset
      </button>

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
        className={focus ? 'og-still' : undefined}
        viewBox={rectStr(restingFrame(VIEW))}
        width="100%"
        height={height}
        role="img"
        aria-label={`Second Brain — ${graph.nodes.length} nodes across ${graph.counts.pillar} departments`}
        onMouseLeave={() => setHover(null)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onClick={() => {
          if (suppressClickRef.current) { suppressClickRef.current = false; return; }
          setFocus(null);
          onSelect?.(null);
        }}
        style={{ cursor: dragging ? 'grabbing' : 'grab', touchAction: 'none' }}
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
                  // No transform easing while this node is being dragged — otherwise it
                  // trails the cursor by the animation duration and feels broken.
                  transition: moved[n.id]
                    ? 'opacity 200ms ease'
                    : 'opacity 200ms ease, transform 420ms var(--ease-out, ease)',
                }}
                onMouseEnter={() => setHover(n.id)}
                onPointerDown={(ev) => {
                  // Claim the gesture so the canvas doesn't pan underneath us.
                  ev.stopPropagation();
                  const p = posOf(n);
                  nodeDragRef.current = { id: n.id, ox: p.x, oy: p.y, sx: ev.clientX, sy: ev.clientY };
                  (ev.currentTarget as SVGGElement).setPointerCapture?.(ev.pointerId);
                }}
                onPointerMove={(ev) => {
                  const d = nodeDragRef.current;
                  if (!d || d.id !== n.id) return;
                  const k = unitsPerPx();
                  setMoved((m) => ({
                    ...m,
                    [n.id]: { x: d.ox + (ev.clientX - d.sx) * k, y: d.oy + (ev.clientY - d.sy) * k },
                  }));
                }}
                onPointerUp={(ev) => {
                  const d = nodeDragRef.current;
                  nodeDragRef.current = null;
                  if (!d) return;
                  // A real drag must not also count as a click, or letting go of a node
                  // would zoom you into it every time.
                  if (Math.hypot(ev.clientX - d.sx, ev.clientY - d.sy) > 4) suppressClickRef.current = true;
                }}
                onClick={(ev) => {
                  ev.stopPropagation();
                  if (suppressClickRef.current) { suppressClickRef.current = false; return; }
                  const next = n.id === focus ? null : n.id;
                  setFocus(next);
                  onSelect?.(next ? n : null);
                }}
              >
                {/* Inner group carries the scale so the growth animates around the
                    node's own centre rather than the SVG origin. The ambient layer sits
                    outside it so drift and scale don't fight over one transform. */}
                <g className={`og-layer-${hashId(n.id) % 3}`}>
                <g style={{ transform: `scale(${s})`, transition: 'transform 260ms var(--ease-out, ease)' }}>
                  <circle r={n.r + 5} fill="none" stroke={col} strokeWidth="1" opacity={n.id === focus ? 0.95 : 0.28} />
                  <circle r={n.r} fill="#0a0a0f" stroke={col} strokeWidth={n.id === focus ? 2.6 : 1.6} />
                  <Icon x={-glyph / 2} y={-glyph / 2} width={glyph} height={glyph} color={col} />
                </g>
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

      {focusNode && (() => {
        const near = [...neighbourhood(graph, focusNode.id)]
          .filter((i) => i !== focusNode.id)
          .map((i) => nodeById.get(i))
          .filter((x): x is OrgNode => !!x);
        const parents = near.filter((x) => x.kind === 'pillar' || x.kind === 'self');
        const children = near.filter((x) => x.kind !== 'pillar' && x.kind !== 'self');
        const col = colorOf(focusNode);
        return (
          <div
            className="absolute top-3 right-24 z-10 w-72 rounded-lg overflow-hidden"
            style={{ background: '#15151b', border: '1px solid rgba(255,255,255,0.12)' }}
          >
            <div className="px-3 py-2.5" style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: col }}>{focusNode.label}</p>
                  <p className="text-[11px]" style={{ color: '#8a8a9a' }}>
                    {[focusNode.meta?.department, focusNode.meta?.type].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <button onClick={() => { setFocus(null); onSelect?.(null); }} aria-label="Close" style={{ color: '#8a8a9a' }}>
                  <X size={13} />
                </button>
              </div>
            </div>

            <div className="px-3 py-2.5 space-y-2.5 max-h-[340px] overflow-y-auto">
              {focusNode.meta?.description && (
                <p className="text-[11px] leading-relaxed" style={{ color: '#c9c9d1' }}>
                  {focusNode.meta.description}
                </p>
              )}

              {(focusNode.meta?.role || focusNode.meta?.status) && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: '#5c5c5c' }}>Detail</p>
                  {focusNode.meta?.role && (
                    <p className="text-[11px]" style={{ color: '#9c9c9c' }}>Role · {focusNode.meta.role}</p>
                  )}
                  {focusNode.meta?.status && (
                    <p className="text-[11px]" style={{ color: '#9c9c9c' }}>Status · {focusNode.meta.status}</p>
                  )}
                  {focusNode.meta?.count && (
                    <p className="text-[11px]" style={{ color: '#9c9c9c' }}>Holds · {focusNode.meta.count}</p>
                  )}
                </div>
              )}

              {parents.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: '#5c5c5c' }}>Reports to</p>
                  {parents.map((x) => (
                    <button
                      key={x.id}
                      className="block w-full text-left text-[11px] truncate hover:underline"
                      style={{ color: colorOf(x) }}
                      onClick={() => { setFocus(x.id); onSelect?.(x); setAreaFilter(''); }}
                    >
                      {x.label}
                    </button>
                  ))}
                </div>
              )}

              {/* EVERYTHING in this area, not just the ones drawn.
                  The ring caps at AREA_CAP because past roughly that many leaves it
                  turns to mush — but the items still exist, and until now there was no
                  way to reach the other 638 of 656 from the graph at all. The full list
                  comes from the same props the graph was built from, so this costs no
                  extra query and cannot disagree with what is drawn. */}
              {areaItems && areaItems.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: '#5c5c5c' }}>
                    Everything here ({areaItems.length})
                  </p>
                  {areaItems.length > 12 && (
                    <input
                      value={areaFilter}
                      onChange={(e) => setAreaFilter(e.target.value)}
                      placeholder="Filter…"
                      className="w-full text-[11px] rounded px-2 py-1 outline-none"
                      style={{ background: '#1a1a1a', border: '1px solid #2c2c2c', color: '#d4d4d4' }}
                    />
                  )}
                  <div className="max-h-56 overflow-y-auto space-y-0.5 pr-1">
                    {visibleAreaItems.map((it) => (
                      <button
                        key={it.id}
                        className="block w-full text-left text-[11px] truncate hover:underline"
                        style={{ color: '#9c9c9c' }}
                        onClick={() => {
                          // Most of these were never drawn, so there is no node to focus.
                          // Selecting still drives the detail panel under the graph,
                          // which is what someone browsing 656 entries actually wants.
                          const drawn = areaKind ? nodeById.get(`${areaKind}:${it.id}`) : null;
                          if (drawn) { setFocus(drawn.id); onSelect?.(drawn); }
                          else if (areaKind) onSelect?.({
                            id: `${areaKind}:${it.id}`,
                            kind: areaKind, label: it.name,
                            x: focusNode.x, y: focusNode.y, r: 0,
                            pillar: focusNode.pillar,
                            meta: { type: focusNode.label.replace(/s$/, ''), entityId: it.id, status: it.status },
                          });
                        }}
                      >
                        {it.name}
                      </button>
                    ))}
                    {visibleAreaItems.length === 0 && (
                      <p className="text-[10px]" style={{ color: '#5c5c5c' }}>Nothing matches.</p>
                    )}
                  </div>
                </div>
              )}

              {children.length > 0 && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider" style={{ color: '#5c5c5c' }}>
                    Connected ({children.length})
                  </p>
                  {children.slice(0, 10).map((x) => (
                    <button
                      key={x.id}
                      className="block w-full text-left text-[11px] truncate hover:underline"
                      style={{ color: '#9c9c9c' }}
                      onClick={() => { setFocus(x.id); onSelect?.(x); }}
                    >
                      {x.label}
                    </button>
                  ))}
                  {children.length > 10 && (
                    <p className="text-[10px]" style={{ color: '#5c5c5c' }}>+{children.length - 10} more</p>
                  )}
                </div>
              )}

              <p className="text-[10px] pt-1" style={{ color: '#5c5c5c' }}>
                Drag any node to move it · Esc to pull back
              </p>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
