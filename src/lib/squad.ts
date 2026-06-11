// The real KeyPlayers agent roster (orchestrator + sub-agents), with display
// metadata + live stats from agent_tasks. Replaces the legacy OpenClaw-config
// agent list. Keep the sub-agent ids in sync with subagent.ts SUBAGENT_REGISTRY.

import { sql, tenantId } from './db/client';
import { SUBAGENT_REGISTRY } from './subagent';

export interface SquadAgentMeta {
  id: string;
  name: string;
  emoji: string;
  role: string;
  model: string;
  description: string;
  // Used by the Agents page to split the roster into "Org Chart" (the
  // executive layer) vs "Specialists" (everything else).
  department: string | null;
  is_executive: boolean;
}

// Display metadata for agents that aren't in SUBAGENT_REGISTRY (orchestrator +
// the system agents), plus nicer names/emojis for the registry ones.
const META: Record<string, { name: string; emoji: string; role: string }> = {
  keyplayer: { name: 'KeyPlayer', emoji: '🎛️', role: 'Orchestrator' },
  fixer: { name: 'Fixer', emoji: '🛠️', role: 'Self-healing' },
  improver: { name: 'Improver', emoji: '🧠', role: 'Auto-research' },
  'research-analyst': { name: 'Research Analyst', emoji: '🔬', role: 'Research' },
  'content-writer': { name: 'Content Writer', emoji: '✍️', role: 'Content' },
  'outreach-sender': { name: 'Outreach Sender', emoji: '📧', role: 'Sales' },
  'calendar-scheduler': { name: 'Calendar Scheduler', emoji: '📅', role: 'Ops' },
  'memory-compactor': { name: 'Memory Compactor', emoji: '🧹', role: 'Memory' },
  'lead-research': { name: 'Lead Research', emoji: '🕵️', role: 'Sales' },
  'thumbnail-generator': { name: 'Thumbnail Generator', emoji: '🖼️', role: 'Content' },
  'hyperframes-agent': { name: 'Hyperframes Agent', emoji: '🎬', role: 'Content' },
  'reel-analyst': { name: 'Reel Analyst', emoji: '🎯', role: 'Research' },
  'reel-ideator': { name: 'Reel Ideator', emoji: '💡', role: 'Content' },
  'reel-optimizer': { name: 'Reel Optimizer', emoji: '🔬', role: 'Content' },
};

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The static fallback roster: orchestrator + bundled sub-agents + system agents.
 *  Used to backfill agents that aren't (yet) present in agent_defs for this tenant. */
export function squadRoster(): SquadAgentMeta[] {
  const roster: SquadAgentMeta[] = [
    {
      id: 'keyplayer',
      ...META.keyplayer,
      model: 'claude-sonnet-4-6',
      description: 'The main agent. Talks to you over iMessage + the boardroom, plans the work, and dispatches the squad.',
      department: 'leadership',
      is_executive: false,
    },
  ];

  for (const spec of Object.values(SUBAGENT_REGISTRY)) {
    const meta = META[spec.id];
    roster.push({
      id: spec.id,
      name: meta?.name ?? titleize(spec.id),
      emoji: meta?.emoji ?? '🤖',
      role: meta?.role ?? 'Specialist',
      model: spec.model,
      description: spec.description,
      department: null,
      is_executive: false,
    });
  }

  roster.push(
    { id: 'fixer', ...META.fixer, model: 'claude-sonnet-4-6', description: 'Reads the repo via GitHub, diagnoses bugs caught by KeyWatch, and opens draft PRs for review.', department: 'operations', is_executive: false },
    { id: 'improver', ...META.improver, model: 'claude-sonnet-4-6', description: 'Reviews the business + system state on a schedule and files improvement proposals as drafts.', department: 'operations', is_executive: false },
  );

  return roster;
}

/** Live roster — every enabled agent_def row, plus the static fallback for
 *  built-ins that haven't been seeded into the DB. Agent Studio additions
 *  (C-suite, custom agents) now show up here automatically. */
async function liveRoster(): Promise<SquadAgentMeta[]> {
  let dbRows: Array<{ id: string; name: string; role: string; role_title: string | null; model: string; description: string; department: string | null; is_executive: boolean }> = [];
  try {
    dbRows = (await sql()`
      SELECT id, name, role, role_title, model, description, department, is_executive
      FROM public.agent_defs
      WHERE tenant_id = ${tenantId()} AND enabled = true
      ORDER BY id
    `) as unknown as typeof dbRows;
  } catch {
    // DB unreachable — fall back to the static roster so the page still renders.
    return squadRoster();
  }

  const out: SquadAgentMeta[] = dbRows.map((r) => ({
    id: r.id,
    name: r.name || titleize(r.id),
    emoji: META[r.id]?.emoji ?? '',
    // Prefer the human role_title ("AI CEO", "Content Writer") over the raw
    // type slug ("orchestrator", "general") so the list reads cleanly.
    role: r.role_title ?? META[r.id]?.role ?? titleize(r.role || 'Specialist'),
    model: r.model,
    description: r.description ?? '',
    department: r.department,
    is_executive: r.is_executive,
  }));

  // Backfill anything in the static roster that the DB hasn't seeded yet
  // (fixer/improver typically, plus any sub-agent not yet upserted).
  const seen = new Set(out.map((a) => a.id));
  for (const m of squadRoster()) if (!seen.has(m.id)) out.push(m);
  return out;
}

export interface SquadAgentStats {
  runs: number;
  running: number;
  last_active: number | null; // epoch seconds
  total_tokens: number;
  last_status: string | null;
}

export interface SquadAgent extends SquadAgentMeta {
  status: 'active' | 'idle' | 'error' | 'planned';
  stats: SquadAgentStats;
}

export async function getSquad(): Promise<SquadAgent[]> {
  const rows = (await sql()`
    SELECT
      agent_id,
      COUNT(*)::int AS runs,
      SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running,
      EXTRACT(EPOCH FROM MAX(started_at))::bigint AS last_active,
      COALESCE(SUM(COALESCE(input_tokens,0) + COALESCE(output_tokens,0)),0)::bigint AS total_tokens,
      (ARRAY_AGG(status ORDER BY started_at DESC))[1] AS last_status
    FROM agent_tasks
    WHERE tenant_id = ${tenantId()}
    GROUP BY agent_id
  `) as unknown as Array<{ agent_id: string; runs: number; running: number; last_active: number | null; total_tokens: number; last_status: string | null }>;

  const byId = new Map(rows.map((r) => [r.agent_id, r]));
  const now = Date.now() / 1000;
  const roster = await liveRoster();

  return roster.map((meta) => {
    const s = byId.get(meta.id);
    const runs = Number(s?.runs ?? 0);
    const running = Number(s?.running ?? 0);
    const lastActive = s?.last_active ? Number(s.last_active) : null;
    const lastStatus = s?.last_status ?? null;

    let status: SquadAgent['status'] = 'planned';
    if (running > 0) status = 'active';
    else if (runs === 0) status = 'planned';
    else if (lastStatus === 'error') status = 'error';
    else if (lastActive && now - lastActive < 60 * 60) status = 'active';
    else status = 'idle';

    return {
      ...meta,
      status,
      stats: { runs, running, last_active: lastActive, total_tokens: Number(s?.total_tokens ?? 0), last_status: lastStatus },
    };
  });
}
