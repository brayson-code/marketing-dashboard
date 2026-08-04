// Brain core instrument — PURE geometry for the Second Brain's summary visual.
//
// Per the spec's build order (Part A.10), this comes before the constellation
// graph: it's small, it server-renders with no state, and it gives the Second Brain
// a presence anywhere for almost nothing.
//
// PURE: no sql, no React. Safe on the server and in the client bundle, and testable
// headlessly — same input, same coordinates, every time.
//
// DETERMINISM IS THE POINT. There is no RNG anywhere in here. What looks organic
// (the jitter on the outer dots, the wobble in the inner ring) is derived from
// integer arithmetic on the index, so the server and client always produce
// identical markup. Coordinates are rounded before render because raw floats
// stringify differently across the two passes and React warns about a cx/cy
// hydration mismatch.

export const CX = 260;
export const CY = 260;
export const VIEWBOX = 520;

/** Ring radii — each ring is a real tier of the knowledge stack, not decoration. */
export const R_OUTER = 210;  // everything we know about
export const R_MIDDLE = 158; // things linked to something else
export const R_INNER = 108;  // the live clusters
export const R_ARC = 76;     // health gauge
export const MAX_CLUSTERS = 6;

/**
 * Polar → cartesian, rounded to 2dp.
 * The rounding is not cosmetic: unrounded floats serialise differently between the
 * server and client React passes and trigger a hydration warning on every node.
 */
export function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [
    Math.round((cx + r * Math.cos(a)) * 100) / 100,
    Math.round((cy + r * Math.sin(a)) * 100) / 100,
  ];
}

export interface BrainCluster { label: string; count: number }
export interface BrainNode { x: number; y: number }
export interface BrainClusterLabel { angle: number; label: string; count: number }

/**
 * Fold a long tail of entity kinds into the six the ring can actually carry.
 * We have ~15 kinds in production; more than six is unreadable at this radius, so
 * the smallest are merged into "other" rather than dropped — the count still has
 * to add up or the ring lies about how much the business knows.
 */
export function foldClusters(
  kinds: ReadonlyArray<BrainCluster>,
  max = MAX_CLUSTERS,
): BrainCluster[] {
  const sorted = [...kinds].filter((k) => k.count > 0).sort(
    (a, b) => b.count - a.count || a.label.localeCompare(b.label),
  );
  if (sorted.length <= max) return sorted;
  const head = sorted.slice(0, max - 1);
  const tail = sorted.slice(max - 1);
  const other = tail.reduce((s, k) => s + k.count, 0);
  return other > 0 ? [...head, { label: 'other', count: other }] : head;
}

/**
 * Lay the inner ring out as clusters, each taking a slice of 360° proportional to
 * its share, starting at −90° (twelve o'clock).
 *
 * `perCluster` caps how many dots one cluster may draw. A cluster with 183 entities
 * would otherwise smear into a solid arc and drown the other five; the slice still
 * reflects the true proportion, only the dot count is sampled.
 */
export function layoutBrainNodes(
  clusters: ReadonlyArray<BrainCluster>,
  perCluster = 14,
): { nodes: BrainNode[]; labels: BrainClusterLabel[] } {
  const total = clusters.reduce((s, c) => s + c.count, 0);
  if (total === 0) return { nodes: [], labels: [] };

  const nodes: BrainNode[] = [];
  const labels: BrainClusterLabel[] = [];
  let angle = -90;

  clusters.forEach((cluster, ci) => {
    const span = (cluster.count / total) * 360;
    labels.push({
      angle: Math.round((angle + span / 2) * 100) / 100,
      label: cluster.label,
      count: cluster.count,
    });

    const dots = Math.max(1, Math.min(perCluster, cluster.count));
    for (let i = 0; i < dots; i++) {
      const a = angle + (span * (i + 0.5)) / dots;
      // Integer-derived jitter — organic-looking, but identical on every render.
      const jitter = ((ci * 7 + i * 13) % 10) - 5;
      const [x, y] = polar(CX, CY, R_INNER + jitter, a);
      nodes.push({ x, y });
    }
    angle += span;
  });

  return { nodes, labels };
}

/** Outer ring: sampled dots on a deterministic wobble, so the boundary reads as a
 *  scatter rather than a drawn circle. */
export function outerDots(n = 42): BrainNode[] {
  const out: BrainNode[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 360 + (i % 5) * 1.7;
    const r = R_OUTER - 4 + ((i * 11) % 9);
    const [x, y] = polar(CX, CY, r, a);
    out.push({ x, y });
  }
  return out;
}

/** Middle ring: eight diamonds (squares rotated 45°). A different MARK per ring is
 *  how three rings stay legible in one hue. */
export function middleDiamonds(n = 8): BrainNode[] {
  return Array.from({ length: n }, (_, i) => {
    const [x, y] = polar(CX, CY, R_MIDDLE, i * 45);
    return { x, y };
  });
}

/** Choose a text-anchor from the label's angle so it never collides with the ring. */
export function labelAnchor(angle: number): 'start' | 'middle' | 'end' {
  const norm = ((angle % 360) + 360) % 360;
  if (norm < 88 || norm > 272) return 'start';
  if (Math.abs(norm - 180) < 88) return 'end';
  return 'middle';
}

/**
 * Health = the share of entities that are connected to at least one other thing.
 *
 * This is a real signal rather than a vanity number: an entity with no relations is
 * something the business recorded once and never linked to anything, which is
 * exactly the knowledge that goes stale. Returns null when there's nothing to
 * measure — the gauge renders an em dash rather than a fake zero.
 */
export function brainHealth(totalEntities: number, connectedEntities: number): number | null {
  if (totalEntities <= 0) return null;
  const pct = (connectedEntities / totalEntities) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}
