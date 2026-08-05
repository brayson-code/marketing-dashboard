// Which department an agent belongs to — PURE.
//
// Bundled specialists are seeded with no department, so they land in a "General" bucket
// on the org chart — a client-facing page under Your AI Team. 35 of 231 agents were
// sitting there, which reads as a dumping ground rather than a team.
//
// The mapping below is DERIVED FROM THE EXISTING DATA, not invented: every pairing here
// is one the already-departmented agents in production agree on unanimously. Categories
// where the real data DISAGREES are deliberately left unmapped, because a confident
// wrong answer on an org chart is worse than an honest "General".

export type Department = 'leadership' | 'marketing' | 'revenue' | 'operations' | 'client_experience';

/**
 * Category → department, only where production data is unanimous.
 *
 * Not mapped, on purpose:
 *   research     — real agents split between marketing and revenue. Genuinely depends
 *                  on what is being researched.
 *   leadership   — the C-suite. Each exec OWNS a different department, so inferring one
 *                  from the category would put them all in the same box.
 *   general      — means "we do not know", which is what General is for.
 */
const BY_CATEGORY: Record<string, Department> = {
  content: 'marketing',
  outreach: 'revenue',
  sales: 'revenue',
  scheduling: 'operations',
  comms: 'operations',
  knowledge: 'operations',
  client: 'client_experience',
  quality: 'client_experience',
  orchestration: 'leadership',
};

/**
 * Agents whose CATEGORY is ambiguous but whose job is not.
 *
 * reel-analyst is categorised 'research', which splits — but it analyses competitor
 * reels alongside reel-ideator and reel-optimizer, and splitting one agent away from
 * the two it works with helps nobody looking at an org chart.
 */
const BY_ID: Record<string, Department> = {
  'reel-analyst': 'marketing',
};

/** The department for an agent, or null when we genuinely do not know. */
export function departmentFor(input: { id?: string | null; category?: string | null }): Department | null {
  const id = String(input.id ?? '').trim().toLowerCase();
  if (id && BY_ID[id]) return BY_ID[id];

  const category = String(input.category ?? '').trim().toLowerCase();
  return BY_CATEGORY[category] ?? null;
}

export const DEPARTMENTS: Department[] = [
  'leadership', 'marketing', 'revenue', 'operations', 'client_experience',
];

export function isDepartment(v: unknown): v is Department {
  return typeof v === 'string' && (DEPARTMENTS as string[]).includes(v);
}

/**
 * Category and role for each bundled specialist.
 *
 * Lived only inside scripts/seed-agent-library.ts, which is why the RUNTIME roster in
 * squad.ts could not use it and hardcoded `department: null` — putting every bundled
 * specialist not yet written to agent_defs into the org chart's "General" bucket.
 * One source now, imported by both.
 */
export const SPECIALIST_CATEGORY: Record<string, { category: string; role: string; niches: string[] }> = {
  'research-analyst':     { category: 'research',   role: 'research',  niches: [] },
  'lead-research':        { category: 'research',   role: 'research',  niches: [] },
  'reel-analyst':         { category: 'research',   role: 'research',  niches: [] },
  'content-writer':       { category: 'content',    role: 'content',   niches: [] },
  'content-cascade':      { category: 'content',    role: 'content',   niches: [] },
  'carousel-generator':   { category: 'content',    role: 'content',   niches: [] },
  'reel-ideator':         { category: 'content',    role: 'content',   niches: [] },
  'reel-optimizer':       { category: 'content',    role: 'content',   niches: [] },
  'hyperframes-agent':    { category: 'content',    role: 'content',   niches: [] },
  'thumbnail-generator':  { category: 'content',    role: 'creative',  niches: [] },
  'outreach-sender':      { category: 'outreach',   role: 'outreach',  niches: [] },
  'sponsor-pitch':        { category: 'sales',      role: 'outreach',  niches: [] },
  'pipeline-review':      { category: 'sales',      role: 'general',   niches: [] },
  'inbox-triage':         { category: 'comms',      role: 'general',   niches: ['landscaping'] },
  'calendar-scheduler':   { category: 'scheduling', role: 'scheduler', niches: [] },
  'community-pulse':      { category: 'client',     role: 'content',   niches: [] },
  'weekly-client-status': { category: 'client',     role: 'general',   niches: [] },
  'client-onboarding-doc':{ category: 'client',     role: 'general',   niches: [] },
  'scope-of-work':        { category: 'client',     role: 'general',   niches: [] },
  'deliverable-qa':       { category: 'quality',    role: 'general',   niches: [] },
  'memory-compactor':     { category: 'knowledge',  role: 'general',   niches: [] },
};

/** The department for a bundled specialist id, resolving its category first. */
export function departmentForSpecialist(id: string): Department | null {
  return departmentFor({ id, category: SPECIALIST_CATEGORY[id]?.category ?? null });
}
