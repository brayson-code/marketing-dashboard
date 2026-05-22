// Phase 2 of the self-improving Command Center (design: KB "Command Center
// PARL"): per-ROLE constraint templates + a source-tier -> KG-confidence rule,
// shared by the wave runner and the cron runner so every spawned agent gets
// boundaries appropriate to its job. Brief principle #1: constraints beat
// instructions — the more specific the boundary, the better the output.
//
// Kept code-defined (keyed by coarse role, per locked decision #3) so they're
// versioned and reviewable; Phase 3 (constraint evolution) can move the winning
// variants into a table.

export type AgentRole = 'research' | 'content' | 'outreach' | 'scheduler' | 'creative' | 'general';

/** Map a sub-agent id to its coarse role (decision #3: start coarse, split later). */
export function roleFor(agentId: string): AgentRole {
  switch (agentId) {
    case 'research-analyst':
    case 'lead-research':
      return 'research';
    case 'content-writer':
      return 'content';
    case 'outreach-sender':
      return 'outreach';
    case 'calendar-scheduler':
      return 'scheduler';
    case 'thumbnail-generator':
    case 'hyperframes-agent':
      return 'creative';
    default:
      return 'general';
  }
}

// Source-quality tiers -> KG confidence. Tier 1 = analyst/official filings,
// Tier 2 = reputable press, Tier 3 = blog/social. Tier 3 lands at 0.5 so it
// shows up under Memory Health's "low confidence (<0.6)" review bucket.
export const TIER_CONFIDENCE: Record<1 | 2 | 3, number> = { 1: 0.9, 2: 0.7, 3: 0.5 };

export function tierToConfidence(tier: number): number {
  if (tier <= 1) return TIER_CONFIDENCE[1];
  if (tier === 2) return TIER_CONFIDENCE[2];
  return TIER_CONFIDENCE[3];
}

const TEMPLATES: Record<AgentRole, string> = {
  research:
    'Constraints: run 5-8 focused web searches; cross-reference 2-3 sources per claim; rate each ' +
    'source Tier 1 (analyst report / official filing), Tier 2 (reputable press), or Tier 3 (blog/social); ' +
    'quantify and DATE every finding; explicitly flag anything you could not verify. Output bullets, each ' +
    'tagged with its source tier and date, e.g. "[T1, 2026-03]".',
  content:
    'Constraints: produce ONE on-brief draft and nothing else (no preamble or commentary); match the ' +
    "target platform's norms (length, format, CTA); never invent statistics — if you cite a number, attribute it; " +
    'output the draft only, ready for the owner to review. This is a draft — it is never auto-published.',
  outreach:
    'Constraints: draft only, never send; <=150 words; one clear ask; a personalized opener tied to a real, ' +
    'cited signal about the recipient; no fabricated claims; plain text. The owner approves before anything goes out.',
  scheduler:
    'Constraints: propose exactly 3 concrete time options with timezone; nothing is booked until the owner confirms.',
  creative:
    'Constraints: deliver ONE concept spec (composition, palette, prompt/storyboard) — not a final asset; ' +
    'note any brand constraints you assumed.',
  general:
    'Constraints: be concise and specific; cite a source for any external/current claim; flag uncertainty explicitly.',
};

/** The role-appropriate constraint block for an agent. */
export function constraintsFor(agentId: string): string {
  return TEMPLATES[roleFor(agentId)];
}

/**
 * Instruction to persist findings to the shared knowledge graph with
 * tier-derived confidence, so the email/sales agents reuse them. Append this
 * when a run should feed the KB/graph (research jobs, saveToKb cron jobs).
 */
export function kgPersistDirective(): string {
  return (
    'When finished, call kg_remember to store the key entities and relationships you found ' +
    '(companies, products, competitors, campaigns and how they relate) so the email and sales agents ' +
    'can reuse them without re-searching. Set each item\'s confidence from your best source tier: ' +
    'Tier 1 = 0.9, Tier 2 = 0.7, Tier 3 = 0.5.'
  );
}
