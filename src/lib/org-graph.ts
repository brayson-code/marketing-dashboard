// Radial org graph — PURE layout for the Second Brain.
//
// Replaces the force-simulation canvas graph. That one ran d3-force live: nodes were
// perpetually solving, every frame nudged them, and touching it kicked the simulation
// again. That is the wobble. Here the layout is a BUILD STEP — solved once from the
// data, deterministically — and the nodes then never move. Anything that moves later is
// camera or ambience.
//
// Determinism rules (from the spec, Part A.0):
//   • no RNG anywhere — a string hash stands in for Math.random
//   • fixed iteration order — arrays, never Set/Map iteration
//   • rounded output — raw floats stringify differently server vs client and React
//     warns about a cx/cy hydration mismatch
//
// The six node kinds mirror the reference exactly (Notes / Pillars / SOP tasks /
// Humans / AI agents / Tools), because that legend IS the spec's CAT record.

// The graph is the brain of the WHOLE operation, not just the org chart: departments and
// agents sit alongside goals, files, contacts and knowledge, because the point is to be
// able to check on anything from one place.
export type OrgNodeKind =
  | 'self' | 'pillar' | 'agent' | 'human' | 'tool'
  | 'task' | 'goal' | 'file' | 'contact' | 'note';

export interface OrgNode {
  id: string;
  kind: OrgNodeKind;
  label: string;
  x: number;
  y: number;
  r: number;
  /** Department this node hangs off — drives colour and drill-down. */
  pillar?: string;
  /** Free-form detail for the inspector panel. */
  meta?: Record<string, string | undefined>;
}

export interface OrgEdge {
  a: string;
  b: string;
  /** Each link type gets its own colour so the chain reads as a SEQUENCE:
   *  self → pillar → agent → tool. */
  rel: 'pillar' | 'member' | 'uses' | 'sop';
}

export interface OrgGraph {
  nodes: OrgNode[];
  edges: OrgEdge[];
  counts: Record<OrgNodeKind, number>;
}

export const VIEW = 1000;
export const C = VIEW / 2;

// Ring radii. Hierarchy is encoded by RADIUS and SIZE, never by dimming — the spec
// records tier-dimming as a reversal: from a zoomed-out view it read as "broken"
// rather than "less important".
const R_PILLAR = 190;
const R_AGENT = 330;
const R_TOOL = 440;

const NODE_R: Record<OrgNodeKind, number> = {
  self: 26, pillar: 19, agent: 13, human: 13, tool: 9.5,
  task: 7, goal: 12, file: 8, contact: 9, note: 6.5,
};

/** The non-department areas of the Command Centre that also hang off the founder.
 *  Ordered so the wheel is stable regardless of how the data arrives. */
export const AREA_PILLARS = [
  { key: 'goals', label: 'Goals', kind: 'goal' as const },
  { key: 'files', label: 'Files & Briefings', kind: 'file' as const },
  { key: 'contacts', label: 'Contacts', kind: 'contact' as const },
  { key: 'knowledge', label: 'Knowledge', kind: 'note' as const },
];

/** Deterministic string hash — stands in for Math.random everywhere in this file. */
export function hashId(s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function polar(cx: number, cy: number, radius: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [r2(cx + radius * Math.cos(a)), r2(cy + radius * Math.sin(a))];
}

/**
 * Fan `count` items across an angular sector, WRAPPING onto concentric sub-rings when
 * the arc can't hold them at a readable spacing.
 *
 * Without this, a department with twenty agents and one with two both get the same arc,
 * so the big one collapses into a pile of overlapping circles. Capacity is derived from
 * real arc length (r·θ) against a minimum spacing, so the layout stays legible at any
 * team size instead of only at the size it was designed against.
 */
function fanPositions(
  count: number,
  midDeg: number,
  insetDeg: number,
  baseR: number,
  spacing = 34,
  ringGap = 42,
): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  if (count <= 0) return out;

  let placed = 0;
  let ring = 0;
  while (placed < count) {
    const r = baseR + ring * ringGap;
    const arcLen = r * (insetDeg * Math.PI) / 180;
    const capacity = Math.max(1, Math.floor(arcLen / spacing));
    const take = Math.min(capacity, count - placed);
    for (let i = 0; i < take; i++) {
      // Centre a short row rather than stretching it across the whole sector.
      const used = take === 1 ? 0 : (take - 1) / Math.max(1, capacity - 1);
      const span = insetDeg * (capacity === 1 ? 0 : used);
      const t = take === 1 ? 0.5 : i / (take - 1);
      const deg = midDeg - span / 2 + t * span;
      out.push([r, deg]);
    }
    placed += take;
    ring += 1;
    if (ring > 6) break; // hard stop; a department with 200 agents is a data problem
  }
  return out;
}

/** Human-readable department names. The raw values are snake_case enum keys. */
export const PILLAR_LABEL: Record<string, string> = {
  leadership: 'Leadership',
  marketing: 'Marketing',
  operations: 'Operations',
  revenue: 'Revenue',
  client_experience: 'Client Experience',
  unassigned: 'General',
};

export interface OrgInput {
  workspace: string;
  agents: ReadonlyArray<{ id: string; name: string; department?: string | null; is_executive?: boolean; role?: string; description?: string }>;
  humans: ReadonlyArray<{ id: string; name: string; role?: string }>;
  tools: ReadonlyArray<{ id: string; name: string; status?: string; department?: string | null }>;
  tasks: ReadonlyArray<{ id: string; name: string; department?: string | null }>;
  // The rest of the Command Centre. Each becomes its own hub off the founder, so the
  // graph answers "what is going on anywhere" rather than only "who works for me".
  goals?: ReadonlyArray<{ id: string; name: string; status?: string }>;
  files?: ReadonlyArray<{ id: string; name: string; status?: string }>;
  contacts?: ReadonlyArray<{ id: string; name: string; status?: string }>;
  notes?: ReadonlyArray<{ id: string; name: string; kind?: string }>;
}

/** Per-area cap. The whole point of a brain view is that you can SEE it — past roughly
 *  this many leaves per hub the ring turns to mush and the browser starts working hard
 *  for no extra understanding. The count in the hub label still reports the true total. */
export const AREA_CAP = 18;

/**
 * Build the radial graph.
 *
 * Structure, working outward: the workspace at the centre, departments on a ring,
 * each department's agents fanned inside that department's own angular sector, and
 * tools on the outermost ring inside the sector of whichever department uses them.
 *
 * Keeping a department's children INSIDE its sector is what stops the picture turning
 * into spaghetti — every edge stays short and local instead of crossing the wheel.
 */
export function buildOrgGraph(input: OrgInput): OrgGraph {
  const nodes: OrgNode[] = [];
  const edges: OrgEdge[] = [];

  nodes.push({
    id: 'self', kind: 'self', label: input.workspace, x: C, y: C, r: NODE_R.self,
    meta: { type: 'Workspace' },
  });

  // Group agents by department, in a FIXED order (sorted), so the same data always
  // produces the same wheel.
  const byPillar = new Map<string, OrgInput['agents'][number][]>();
  for (const a of input.agents) {
    const p = a.department || 'unassigned';
    const list = byPillar.get(p);
    if (list) list.push(a); else byPillar.set(p, [a]);
  }
  const pillars = [...byPillar.keys()].sort();
  for (const p of pillars) byPillar.get(p)!.sort((x, y) => x.name.localeCompare(y.name));

  // Area hubs (Goals / Files / Contacts / Knowledge) share the pillar ring with the
  // departments, so the founder is surrounded by everything the Command Centre holds
  // rather than only by the org chart. Empty areas are skipped — an always-present hub
  // with nothing under it just teaches people the graph is decorative.
  const areaData: Record<string, ReadonlyArray<{ id: string; name: string; status?: string; kind?: string }>> = {
    goals: input.goals ?? [],
    files: input.files ?? [],
    contacts: input.contacts ?? [],
    knowledge: input.notes ?? [],
  };
  const areas = AREA_PILLARS.filter((a) => (areaData[a.key]?.length ?? 0) > 0);

  const n = Math.max(1, pillars.length + areas.length);
  const sector = 360 / n;

  // Tools and humans are distributed across sectors deterministically when they carry
  // no department of their own — by hash, so a given tool always lands in the same
  // place rather than jumping between renders.
  const toolsByPillar = new Map<string, OrgInput['tools'][number][]>();
  for (const t of input.tools) {
    const p = t.department && byPillar.has(t.department)
      ? t.department
      : pillars[hashId(t.id) % n];
    const list = toolsByPillar.get(p);
    if (list) list.push(t); else toolsByPillar.set(p, [t]);
  }
  for (const [, list] of toolsByPillar) list.sort((x, y) => x.name.localeCompare(y.name));

  pillars.forEach((pillar, pi) => {
    // −90° puts the first department at twelve o'clock.
    const mid = -90 + sector * pi + sector / 2;
    const [px, py] = polar(C, C, R_PILLAR, mid);
    const pid = `pillar:${pillar}`;
    nodes.push({
      id: pid, kind: 'pillar', label: PILLAR_LABEL[pillar] ?? pillar,
      x: px, y: py, r: NODE_R.pillar, pillar,
      meta: { type: 'Department' },
    });
    edges.push({ a: 'self', b: pid, rel: 'pillar' });

    // Agents fan across the department's sector, inset so neighbouring departments
    // never touch.
    const members = byPillar.get(pillar)!;
    const inset = sector * 0.82;
    const slots = fanPositions(members.length, mid, inset, R_AGENT);
    members.forEach((m, i) => {
      const [sr, deg] = slots[i];
      // Integer-derived wobble so the ring reads organic without any RNG. Small enough
      // that it can't reintroduce an overlap the spacing just solved.
      const wob = ((hashId(m.id) % 5) - 2) * 2;
      const [x, y] = polar(C, C, sr + wob, deg);
      const id = `agent:${m.id}`;
      nodes.push({
        id, kind: 'agent', label: m.name, x, y, r: NODE_R.agent, pillar,
        meta: {
          type: m.is_executive ? 'AI executive' : 'AI agent',
          role: m.role,
          description: m.description,
        },
      });
      edges.push({ a: pid, b: id, rel: 'member' });
    });

    // Tools sit outside their department, connected to it — short local edges.
    const tools = toolsByPillar.get(pillar) ?? [];
    const toolInset = sector * 0.7;
    const toolSlots = fanPositions(tools.length, mid, toolInset, R_TOOL, 26, 30);
    tools.forEach((t, i) => {
      const [tr, deg] = toolSlots[i];
      const wob = ((hashId(t.id) % 5) - 2) * 2;
      const [x, y] = polar(C, C, tr + wob, deg);
      const id = `tool:${t.id}`;
      nodes.push({
        id, kind: 'tool', label: t.name, x, y, r: NODE_R.tool, pillar,
        meta: { type: 'Tool', status: t.status },
      });
      edges.push({ a: pid, b: id, rel: 'uses' });
    });
  });

  // Area hubs, continuing round the same ring after the departments.
  areas.forEach((area, ai) => {
    const mid = -90 + sector * (pillars.length + ai) + sector / 2;
    const [px, py] = polar(C, C, R_PILLAR, mid);
    const pid = `area:${area.key}`;
    const items = areaData[area.key] ?? [];
    nodes.push({
      id: pid, kind: 'pillar', label: area.label,
      x: px, y: py, r: NODE_R.pillar, pillar: area.key,
      // The label reports the TRUE total even though only AREA_CAP are drawn, so the
      // graph never quietly under-reports how much is in there.
      meta: { type: 'Area', count: String(items.length) },
    });
    edges.push({ a: 'self', b: pid, rel: 'pillar' });

    const shown = items.slice(0, AREA_CAP);
    const inset = sector * 0.82;
    const slots = fanPositions(shown.length, mid, inset, R_AGENT, 30, 40);
    shown.forEach((it, i) => {
      const [sr, deg] = slots[i];
      const wob = ((hashId(it.id) % 5) - 2) * 2;
      const [x, y] = polar(C, C, sr + wob, deg);
      const id = `${area.kind}:${it.id}`;
      nodes.push({
        id, kind: area.kind, label: it.name, x, y, r: NODE_R[area.kind], pillar: area.key,
        meta: { type: area.label.replace(/s$/, ''), status: it.status, entityId: it.id },
      });
      edges.push({ a: pid, b: id, rel: 'member' });
    });
  });

  // Humans ride the agent ring but render in the WARNING colour: in a board of AI
  // agents a human is the exception that needs attention. Placed on their own arc so
  // they read as a group.
  input.humans.forEach((h, i) => {
    const deg = -90 + (360 * (i + 0.5)) / Math.max(1, input.humans.length);
    const [x, y] = polar(C, C, R_AGENT - 62, deg);
    const id = `human:${h.id}`;
    nodes.push({
      id, kind: 'human', label: h.name, x, y, r: NODE_R.human,
      meta: { type: 'Human', role: h.role },
    });
    edges.push({ a: 'self', b: id, rel: 'member' });
  });

  // SOP tasks — small marks between the pillar and agent rings.
  input.tasks.forEach((t, i) => {
    const deg = -90 + (360 * (i + 0.5)) / Math.max(1, input.tasks.length) + 3;
    const wob = ((hashId(t.id) % 11) - 5) * 3;
    const [x, y] = polar(C, C, (R_PILLAR + R_AGENT) / 2 + wob, deg);
    const id = `task:${t.id}`;
    nodes.push({
      id, kind: 'task', label: t.name, x, y, r: NODE_R.task,
      pillar: t.department ?? undefined,
      meta: { type: 'SOP task' },
    });
  });

  const counts = nodes.reduce(
    (acc, nd) => { acc[nd.kind] += 1; return acc; },
    { self: 0, pillar: 0, agent: 0, human: 0, tool: 0, task: 0,
      goal: 0, file: 0, contact: 0, note: 0 } as Record<OrgNodeKind, number>,
  );

  return { nodes, edges, counts };
}

/**
 * Re-lay a focused node's subtree as an ORG CHART anchored at the node itself.
 *
 * The focused node holds its position and its descendants stack in tiers ABOVE it, the
 * way a division sits under the business on an org chart. Everything else in the graph
 * keeps its radial position and simply dims, so the focused branch reads as being
 * pulled forward out of the wheel rather than replacing it.
 *
 * Tiers go, bottom to top: the node → its SOP tasks → the agents who do the work →
 * the tools they use. That ordering is the actual chain of delegation.
 */
export function treeLayout(graph: OrgGraph, focusId: string): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const root = graph.nodes.find((n) => n.id === focusId);
  if (!root) return pos;

  const children = graph.edges.filter((e) => e.a === focusId).map((e) => e.b);
  const kindOf = new Map(graph.nodes.map((n) => [n.id, n.kind] as const));

  // Tools hang off the agents conceptually, but in the data they hang off the pillar —
  // so they're split out here by kind rather than by another edge walk.
  const agents = children.filter((id) => kindOf.get(id) === 'agent' || kindOf.get(id) === 'human');
  const tools = children.filter((id) => kindOf.get(id) === 'tool');
  // Everything else hanging off this hub — goals, files, contacts, knowledge. Without
  // this the non-org hubs keep their radial positions while the camera zooms in on
  // them, which lands as a pile of overlapping labels.
  const leaves = children.filter((id) => {
    const k = kindOf.get(id);
    return k !== 'agent' && k !== 'human' && k !== 'tool';
  });
  const tasks = graph.nodes
    .filter((n) => n.kind === 'task' && n.pillar === root.pillar)
    .map((n) => n.id);

  /** Lay a set out in centred rows, wrapping at `perRow` so a hub with twenty children
   *  becomes a readable block rather than one row running off the canvas. */
  const rows = (ids: string[], startDy: number, gap: number, perRow = 7, rowGap = 96) => {
    if (ids.length === 0) return;
    for (let i = 0; i < ids.length; i += perRow) {
      const slice = ids.slice(i, i + perRow);
      const width = (slice.length - 1) * gap;
      const dy = startDy - (i / perRow) * rowGap;
      slice.forEach((id, j) => {
        pos.set(id, { x: r2(root.x - width / 2 + j * gap), y: r2(root.y + dy) });
      });
    }
  };

  pos.set(focusId, { x: root.x, y: root.y });
  rows(tasks.slice(0, 10), -130, 92, 6);
  rows(agents, -270, 104, 7);
  rows(tools, -410, 108, 7);
  // Leaves start just above the hub and stack upward in rows of six.
  rows(leaves, -150, 120, 6, 104);

  return pos;
}

/** Ids reachable from a node in one hop — drives hover-isolate and drill-down. */
export function neighbourhood(graph: OrgGraph, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (const e of graph.edges) {
    if (e.a === id) out.add(e.b);
    else if (e.b === id) out.add(e.a);
  }
  return out;
}

/** Everything under a department, for the drill-down view. */
export function subtreeOf(graph: OrgGraph, pillarId: string): Set<string> {
  const out = new Set<string>([pillarId]);
  for (const e of graph.edges) {
    if (e.a === pillarId) out.add(e.b);
  }
  return out;
}
