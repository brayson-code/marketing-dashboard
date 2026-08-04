import {
  CX, CY, VIEWBOX, R_OUTER, R_ARC,
  outerDots, middleDiamonds, layoutBrainNodes, labelAnchor,
  type BrainCluster,
} from '@/lib/brain-viz';

// The Second Brain core instrument — a radar/gauge that reads as machinery.
//
// SERVER component on purpose: pure SVG, no state, no hooks, no client bundle cost.
// The expensive deterministic layout runs once at render and never re-runs. If this
// ever needs interactivity, WRAP it in a client shell — do not give the SVG state.
//
// All motion is CSS (see globals.css, .brain-*). Three rings turn at 80s / 140s /
// 220s with the MIDDLE ONE REVERSED — the counter-rotation is the detail that sells
// it as a machine rather than a spinner. Every speed is deliberately below conscious
// perception; the eye registers "alive" without ever resolving "spinning".
//
// Palette: KeyPlayers tokens (option A — the spec's structure and motion, our
// colour), so this sits inside the product rather than next to it.

export function BrainCore({
  clusters,
  health,
  totalEntities,
  size = 320,
}: {
  clusters: BrainCluster[];
  /** 0–100, or null when there's nothing to measure (renders an em dash). */
  health: number | null;
  totalEntities: number;
  size?: number;
}) {
  const { nodes, labels } = layoutBrainNodes(clusters);
  const outer = outerDots();
  const diamonds = middleDiamonds();

  // Progress-ring technique: a dasharray arc on a circle rotated −90° so it starts
  // at twelve o'clock. No dependency, no path maths.
  const C = 2 * Math.PI * R_ARC;
  const healthArc = ((health ?? 0) / 100) * C;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX} ${VIEWBOX}`}
      width={size}
      height={size}
      role="img"
      aria-label={
        health === null
          ? 'Second Brain — no entities recorded yet'
          : `Second Brain — ${health}% of ${totalEntities} entities connected`
      }
      className="shrink-0"
    >
      <defs>
        <linearGradient id="brainArcGrad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--brain-1)" />
          <stop offset="55%" stopColor="var(--brain-2)" />
          <stop offset="100%" stopColor="var(--brain-3)" />
        </linearGradient>
        {/* The sweep fades to 13% — any stronger and it stops being ambient. */}
        <linearGradient id="brainSweepGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--brain-2)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--brain-2)" stopOpacity="0.13" />
        </linearGradient>
      </defs>

      {/* ── Outer ring — everything recorded. Mostly-gap guide so it reads as a
          boundary, not a drawn line. 220s forward. ─────────────────────────── */}
      <circle
        cx={CX} cy={CY} r={R_OUTER} fill="none"
        stroke="var(--brain-3)" strokeDasharray="2 7" strokeWidth="1" opacity="0.7"
      />
      <g className="brain-ring r3">
        {outer.map((d, i) => (
          <circle key={i} cx={d.x} cy={d.y} r="1.6" fill="var(--brain-3)" opacity="0.85" />
        ))}
      </g>

      {/* ── Middle ring — diamonds. 140s REVERSE. ──────────────────────────── */}
      <g className="brain-ring r2">
        {diamonds.map((d, i) => (
          <rect
            key={i}
            x={d.x - 2.6} y={d.y - 2.6} width="5.2" height="5.2"
            transform={`rotate(45 ${d.x} ${d.y})`}
            fill="var(--brain-2)" opacity="0.85"
          />
        ))}
      </g>

      {/* ── Inner ring — the live clusters. Spoke + node + halo; the 30% halo is
          what produces glow without an SVG filter. 80s forward. ───────────── */}
      <g className="brain-ring r1">
        {nodes.map((n, i) => (
          <g key={i}>
            <line
              x1={CX} y1={CY} x2={n.x} y2={n.y}
              stroke="var(--brain-1)" strokeWidth="0.5" opacity="0.18"
            />
            <circle cx={n.x} cy={n.y} r="3.4" fill="var(--brain-1)" />
            <circle
              cx={n.x} cy={n.y} r="6.5" fill="none"
              stroke="var(--brain-1)" strokeWidth="0.6" opacity="0.3"
            />
          </g>
        ))}
      </g>

      {/* ── Radar sweep — the only element moving at a speed you consciously
          notice (9s). ─────────────────────────────────────────────────────── */}
      <g className="brain-sweep">
        <path d={`M${CX} ${CY} L${CX} 40 A220 220 0 0 1 369 69 Z`} fill="url(#brainSweepGrad)" />
      </g>

      {/* ── Cluster labels — static, outside the rotating groups, anchored by
          angle so text never collides with the ring. ──────────────────────── */}
      {labels.map((l, i) => {
        const [lx, ly] = [
          Math.round((CX + 134 * Math.cos((l.angle * Math.PI) / 180)) * 100) / 100,
          Math.round((CY + 134 * Math.sin((l.angle * Math.PI) / 180)) * 100) / 100,
        ];
        return (
          <text
            key={i}
            x={lx} y={ly}
            textAnchor={labelAnchor(l.angle)}
            dominantBaseline="middle"
            fill="var(--brain-2)"
            fontSize="11"
            letterSpacing="1.4"
            style={{ textTransform: 'uppercase' }}
          >
            {l.label} {l.count}
          </text>
        );
      })}

      {/* ── Health gauge + readout. Breathes 3.5% over 3.2s. ───────────────── */}
      <g className="brain-core-pulse">
        <circle cx={CX} cy={CY} r={R_ARC} fill="none" stroke="var(--surface-3)" strokeWidth="5" opacity="0.5" />
        {health !== null && (
          <circle
            cx={CX} cy={CY} r={R_ARC} fill="none"
            stroke="url(#brainArcGrad)" strokeWidth="5" strokeLinecap="round"
            strokeDasharray={`${Math.round(healthArc * 100) / 100} ${Math.round(C * 100) / 100}`}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        )}
        <circle cx={CX} cy={CY} r="58" fill="var(--card)" stroke="var(--border)" strokeWidth="1" />
        {/* 30px number against an 8px label — a 4× ratio is what makes a readout
            look like an instrument rather than body copy. */}
        <text
          x={CX} y={CY - 4} textAnchor="middle" dominantBaseline="middle"
          fill="var(--foreground)" fontSize="30" fontWeight="600"
        >
          {health ?? '—'}
        </text>
        <text
          x={CX} y={CY + 20} textAnchor="middle" dominantBaseline="middle"
          fill="var(--muted-foreground)" fontSize="8" letterSpacing="2.5"
          style={{ textTransform: 'uppercase' }}
        >
          connected
        </text>
      </g>
    </svg>
  );
}
