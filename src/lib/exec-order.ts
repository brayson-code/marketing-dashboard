// Canonical C-suite seniority order — the SINGLE source of truth for anywhere the
// executive layer's DISPLAY order matters: the Leadership lens hero row
// (src/app/api/hero-agents/route.ts), the Agents page's "Org chart" section
// (src/app/agents/squads/page.tsx), and the Command Chat picker's Executives group
// (src/components/dashboard/agent-chat-widget.tsx).
//
// PURE: no `sql`/server imports, no React — safe to import from a server route AND
// client components, same split as dashboard-widgets.ts.
//
// This is a SORT-LAYER fix, not a data fix — agent_defs rows/ids are never mutated.
// Each consumer used to sort independently and disagreed with real org seniority:
// hero-agents ordered by `department` (leadership, marketing, revenue, operations,
// client_experience → CEO, CMO, CRO, COO, CXO) and the squads page sorted the rest
// alphabetically by name (CMO, COO, CRO, CXO) — both put COO after CMO/CRO instead
// of right behind the CEO. One ranked list now, reused everywhere.
const CANONICAL_EXEC_ORDER: readonly string[] = [
  'keyplayer', // the orchestrator always leads when it's part of the list
  'ai-ceo',
  'ai-coo',
  'ai-cmo',
  'ai-cro',
  'ai-cfo', // not seeded yet — reserved slot so a future CFO lands in the right spot
  'ai-cto', // ditto for a future CTO
  'ai-cxo',
];

/** Lower = more senior. Anything not in the canonical list (a future/custom exec)
 *  sorts after every known one, rather than crashing or floating to the top. */
export function execRank(id: string): number {
  const i = CANONICAL_EXEC_ORDER.indexOf(id);
  return i === -1 ? CANONICAL_EXEC_ORDER.length : i;
}

/** Array.prototype.sort comparator: canonical rank first, then name as a stable,
 *  deterministic tiebreak for anything outside the known list. */
export function compareExecOrder(a: { id: string; name?: string }, b: { id: string; name?: string }): number {
  const r = execRank(a.id) - execRank(b.id);
  if (r !== 0) return r;
  return (a.name ?? '').localeCompare(b.name ?? '');
}
