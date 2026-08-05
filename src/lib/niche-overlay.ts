// Industry overlay — PURE. Industries WE define, on top of Brayson's seeded catalog.
//
// ── WHY THIS EXISTS AS AN OVERLAY AND NOT AS DATA ────────────────────────────
// scripts/seed-agent-library.ts upserts agent_library by id and replaces
// default_niches WHOLESALE (`default_niches = EXCLUDED.default_niches`). So adding an
// industry by tagging an existing archetype row in the database would be silently
// reverted the next time that seed runs against keycommand-provisioning's
// niche-config.json — no error, no conflict, the industry just stops existing.
//
// Its cleanup DELETE only targets `source = 'niche' OR id LIKE 'niche-%'`, so rows and
// mappings that live OUTSIDE those ids are safe. Hence: never edit his rows, declare
// ours here instead. This mapping is version-controlled, reviewable in a PR, and
// survives any number of reseeds.
//
// LONG-TERM: this and niche-config.json are two sources of truth for one concept.
// That's fine now and bad later — the intended end state is Brayson folding these into
// niche-config so there's one list again.
//
// Every id below must exist in agent_library (source='archetype'). They are reused, not
// copied: one prompt body, many industries — the same dedupe his July change made.

export interface OverlayNiche {
  /** Display name. */
  name: string;
  /** agent_library ids this industry pre-selects. */
  archetypes: string[];
  /** The money leak this roster is aimed at. Shown to the operator. */
  note: string;
}

export const NICHE_OVERLAY: Record<string, OverlayNiche> = {
  marketing_agency: {
    name: 'Marketing Agency',
    note: 'Retainers die from silence, not bad work. Reporting, renewals and AR are where agencies actually leak.',
    archetypes: [
      'archetype-speed-to-lead', 'archetype-follow-up', 'archetype-estimator',
      'archetype-report-builder', 'archetype-renewal', 'archetype-collections',
      'archetype-referral', 'archetype-reactivation',
    ],
  },
  gtm_agency: {
    name: 'GTM Agency',
    note: 'Sells pipeline, so it has to run its own. Prospect research and reporting are the billable proof.',
    archetypes: [
      'archetype-speed-to-lead', 'archetype-follow-up', 'archetype-research-scout',
      'archetype-estimator', 'archetype-report-builder', 'archetype-renewal',
      'archetype-reactivation', 'archetype-collections',
    ],
  },
  consulting: {
    name: 'Consulting Business',
    note: 'Wins on proposal speed and repeat work. Past clients and past deliverables are the real pipeline.',
    archetypes: [
      'archetype-speed-to-lead', 'archetype-follow-up', 'archetype-estimator',
      'archetype-doc-rag', 'archetype-report-builder', 'archetype-collections',
      'archetype-referral', 'archetype-reactivation',
    ],
  },
  medical_practice: {
    name: 'Medical Practice',
    note: 'Every empty chair is unrecoverable revenue. No-shows, recalls and reviews carry the practice.',
    archetypes: [
      'archetype-scheduler', 'archetype-no-show', 'archetype-follow-up',
      'archetype-speed-to-lead', 'archetype-reactivation', 'archetype-review',
      'archetype-doc-rag', 'archetype-collections',
    ],
  },
  law_firm: {
    name: 'Law Firm',
    note: 'Intake speed decides who gets the case. After that it is documents, deadlines and billing.',
    archetypes: [
      'archetype-speed-to-lead', 'archetype-follow-up', 'archetype-scheduler',
      'archetype-doc-rag', 'archetype-estimator', 'archetype-collections',
      'archetype-referral', 'archetype-reactivation',
    ],
  },
  ecommerce: {
    name: 'E-commerce Brand',
    note: 'Second orders are the whole business. Repeat purchase, reviews and lapsed buyers beat new traffic.',
    archetypes: [
      'archetype-upsell', 'archetype-reactivation', 'archetype-review',
      'archetype-report-builder', 'archetype-follow-up', 'archetype-monitor',
      'archetype-referral',
    ],
  },
  saas: {
    name: 'SaaS Company',
    note: 'Renewal is the revenue event. Churn shows up in usage long before anyone cancels.',
    archetypes: [
      'archetype-renewal', 'archetype-speed-to-lead', 'archetype-follow-up',
      'archetype-report-builder', 'archetype-research-scout', 'archetype-reactivation',
      'archetype-monitor',
    ],
  },
  veterinary: {
    name: 'Veterinary Practice',
    note: 'Runs on recalls. Vaccines, check-ups and lapsed pets are predictable revenue nobody chases.',
    archetypes: [
      'archetype-scheduler', 'archetype-no-show', 'archetype-reactivation',
      'archetype-review', 'archetype-follow-up', 'archetype-speed-to-lead',
      'archetype-collections',
    ],
  },
  chiropractic: {
    name: 'Chiropractic & Physio',
    note: 'Care plans only pay if patients finish them. Drop-off mid-plan is the single biggest leak.',
    archetypes: [
      'archetype-scheduler', 'archetype-no-show', 'archetype-reactivation',
      'archetype-review', 'archetype-follow-up', 'archetype-speed-to-lead',
      'archetype-renewal',
    ],
  },
  commercial_cleaning: {
    name: 'Commercial Cleaning',
    note: 'Contract renewals and quote turnaround decide the year. Complaints churn accounts fast.',
    archetypes: [
      'archetype-speed-to-lead', 'archetype-estimator', 'archetype-follow-up',
      'archetype-renewal', 'archetype-collections', 'archetype-monitor',
      'archetype-referral', 'archetype-reactivation',
    ],
  },
};

/** True when this slug is one of ours rather than one of Brayson's seeded niches. */
export function isOverlayNiche(slug: string): boolean {
  return Object.prototype.hasOwnProperty.call(NICHE_OVERLAY, String(slug ?? '').trim().toLowerCase());
}

/** agent_library ids for an overlay industry; empty for anything else. */
export function overlayArchetypesFor(slug: string): string[] {
  return NICHE_OVERLAY[String(slug ?? '').trim().toLowerCase()]?.archetypes ?? [];
}

/** Every overlay industry as {slug, agents} — same shape listNiches() returns. */
export function overlayNiches(): Array<{ slug: string; agents: number }> {
  return Object.entries(NICHE_OVERLAY).map(([slug, n]) => ({ slug, agents: n.archetypes.length }));
}

export function overlayNote(slug: string): string | null {
  return NICHE_OVERLAY[String(slug ?? '').trim().toLowerCase()]?.note ?? null;
}
