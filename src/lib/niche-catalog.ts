// Industry display names — PURE (no db import, safe in client components).
//
// agent_library.default_niches stores machine slugs ('personal_injury_law'). Those are
// fine as keys and wrong as copy: an operator setting up a client should read
// "Personal Injury Law", not a column value.
//
// The map is EXPLICIT rather than derived because the exceptions are the point —
// title-casing the slug gives "Hvac", "Med Spa", "Property Mgmt". Anything not listed
// falls back to a readable title-case so a niche seeded later still renders sensibly
// instead of throwing or showing a raw slug.

import { NICHE_OVERLAY } from './niche-overlay';

const DISPLAY: Record<string, string> = {
  accounting: 'Accounting',
  auto_dealership: 'Auto Dealership',
  beverage: 'Beverage',
  coaching: 'Coaching',
  concierge_medicine: 'Concierge Medicine',
  construction: 'Construction',
  dental: 'Dental',
  financial_advisors: 'Financial Advisors',
  fitness: 'Fitness',
  hvac: 'HVAC',
  insurance: 'Insurance',
  landscaping: 'Landscaping',
  med_spa: 'Med Spa',
  mortgage: 'Mortgage',
  personal_injury_law: 'Personal Injury Law',
  property_mgmt: 'Property Management',
  real_estate: 'Real Estate',
  restaurants: 'Restaurants',
  roofing: 'Roofing',
  solar: 'Solar',
  staffing: 'Staffing',
  vending: 'Vending',
};

/** Readable industry name for a niche slug. Unknown slugs title-case rather than fail. */
export function nicheName(slug: string): string {
  const key = String(slug ?? '').trim().toLowerCase();
  if (!key) return 'Unknown';
  // Overlay industries carry their own display name, so adding one is a single edit in
  // niche-overlay.ts rather than two files that can drift apart.
  return NICHE_OVERLAY[key]?.name
    ?? DISPLAY[key]
    ?? key.split(/[_-]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** True when we have authored copy for this slug (vs falling back to title-case). */
export function hasNicheName(slug: string): boolean {
  const key = String(slug ?? '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DISPLAY, key)
    || Object.prototype.hasOwnProperty.call(NICHE_OVERLAY, key);
}

// Category labels, same reasoning — 'client' and 'comms' are column values, not words
// an operator should have to interpret.
const CATEGORY: Record<string, string> = {
  research: 'Research',
  content: 'Content',
  outreach: 'Outreach',
  sales: 'Sales',
  scheduling: 'Scheduling',
  comms: 'Communication',
  client: 'Client Experience',
  quality: 'Quality',
  knowledge: 'Knowledge',
  leadership: 'Leadership',
  orchestration: 'Orchestration',
  general: 'General',
};

export function categoryName(slug: string): string {
  const key = String(slug ?? '').trim().toLowerCase();
  return CATEGORY[key] ?? nicheName(key);
}

/**
 * Why an agent is in a roster. The library mixes three kinds of row and an operator
 * needs to tell them apart: the C-suite and universal defaults ship with EVERY command
 * centre, so only the niche rows are what makes this industry's roster different.
 */
export type RosterReason = 'niche' | 'executive' | 'default';

export function rosterReason(a: { source: string; is_executive: boolean }): RosterReason {
  if (a.is_executive || a.source === 'exec') return 'executive';
  if (a.source === 'default') return 'default';
  return 'niche';
}

export const REASON_LABEL: Record<RosterReason, string> = {
  niche: 'Industry-specific',
  executive: 'Ships with every workspace',
  default: 'Ships with every workspace',
};
