// Agent recommendations — PURE.
//
// NOT A MARKETPLACE. The useful question isn't "which agents could you add", it's
// "what is stopping the team you already have from working". An outreach agent with no
// email connected is dead weight, and nothing on screen says so — it just quietly does
// nothing. This turns that into a sentence somebody can act on.
//
// HONEST ABOUT ITS OWN CONFIDENCE: agents don't declare their dependencies in the data,
// so the agent→connection mapping below is inferred from an agent's ROLE. That's a
// heuristic, and the UI says so rather than presenting it as fact. If agent definitions
// ever gain an explicit `requires` field, delete REQUIRED_BY_ROLE and read that instead.

export interface RecAgent {
  id: string;
  name: string;
  role?: string;
  department?: string | null;
}

export interface RecConnection {
  key: string;
  label: string;
  connected: boolean;
}

export interface Recommendation {
  id: string;
  /** blocked = it can't do its job today. idle = nothing is wrong, it's just unused. */
  kind: 'blocked' | 'idle';
  title: string;
  detail: string;
  /** Where to go to fix it. */
  href: string;
  cta: string;
}

/**
 * What each kind of agent needs connected before it can actually finish its work.
 * Keyed by the `role` on an agent definition.
 *
 * Deliberately conservative: only roles whose dependency is genuinely unambiguous are
 * listed. A wrong "you must connect X" is worse than no advice, because it sends people
 * to set up something they don't need and teaches them to ignore the panel.
 */
const REQUIRED_BY_ROLE: Record<string, { any: string[]; one: string; many: string }> = {
  outreach: {
    any: ['gmail', 'google'],
    one: 'it can draft outreach but has no mailbox to send from',
    many: 'they can draft outreach but have no mailbox to send from',
  },
  scheduler: {
    any: ['google', 'gmail'],
    one: 'it can propose times but cannot see or write a calendar',
    many: 'they can propose times but cannot see or write a calendar',
  },
  content: {
    any: ['youtube', 'linkedin', 'instagram', 'facebook', 'x', 'tiktok'],
    one: 'it can write posts but has nowhere to publish them',
    many: 'they can write posts but have nowhere to publish them',
  },
};

/**
 * Build the list. Blocked items first — those are real problems; idle ones are only
 * worth a look.
 */
export function buildRecommendations(
  agents: ReadonlyArray<RecAgent>,
  connections: ReadonlyArray<RecConnection>,
): Recommendation[] {
  const connected = new Set(
    connections.filter((c) => c.connected).map((c) => c.key.toLowerCase()),
  );
  const labelFor = (k: string) =>
    connections.find((c) => c.key.toLowerCase() === k)?.label
    ?? k.charAt(0).toUpperCase() + k.slice(1);

  const out: Recommendation[] = [];

  // Group by role so we say "your 3 outreach agents" once, rather than repeating the
  // same missing connection for each of them.
  const byRole = new Map<string, RecAgent[]>();
  for (const a of agents) {
    const r = (a.role ?? '').toLowerCase();
    if (!REQUIRED_BY_ROLE[r]) continue;
    const list = byRole.get(r);
    if (list) list.push(a); else byRole.set(r, [a]);
  }

  for (const role of [...byRole.keys()].sort()) {
    const need = REQUIRED_BY_ROLE[role];
    if (need.any.some((k) => connected.has(k))) continue; // already satisfied
    const list = byRole.get(role)!;
    const names = list.slice(0, 3).map((a) => a.name).join(', ');
    const more = list.length > 3 ? ` and ${list.length - 3} more` : '';
    const options = need.any.slice(0, 3).map(labelFor).join(' or ');
    out.push({
      id: `blocked:${role}`,
      kind: 'blocked',
      title: list.length === 1
        ? `${list[0].name} can't finish its work`
        : `${list.length} ${role} agents can't finish their work`,
      detail: `${names}${more} — ${list.length === 1 ? need.one : need.many}. `
        + `Connect ${options} and ${list.length === 1 ? 'it starts' : 'they start'} working.`,
      href: '/connections',
      cta: 'Open Connections',
    });
  }

  // Nothing connected at all is worth saying plainly rather than as N separate rows.
  if (connected.size === 0 && agents.length > 0) {
    out.unshift({
      id: 'blocked:nothing-connected',
      kind: 'blocked',
      title: 'No accounts are connected yet',
      detail: `You have ${agents.length} agents ready. Until an account is connected they can research and draft, but nothing can reach the outside world.`,
      href: '/connections',
      cta: 'Connect an account',
    });
  }

  // Agents with no department are real: they pile into "General" and nobody knows who
  // owns them. Surfaced as idle rather than blocked — nothing is broken, it's just
  // untidy in a way that shows up on the org chart.
  const unassigned = agents.filter((a) => !a.department);
  if (unassigned.length > 2) {
    out.push({
      id: 'idle:unassigned',
      kind: 'idle',
      title: `${unassigned.length} agents have no department`,
      detail: 'They group under "General" on the org chart and in the Second Brain. Assigning them makes both easier to read.',
      href: '/org-chart',
      cta: 'See the org chart',
    });
  }

  return out;
}
