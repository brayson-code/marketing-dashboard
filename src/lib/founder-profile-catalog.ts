// Founder profile CATALOG — the PURE half: field definitions, types, validation and
// the brief renderer. No `sql` import, so this module is safe in the BROWSER bundle
// (the Founder Profile page renders its form straight off FOUNDER_FIELDS).
//
// Same split as command-center-catalog.ts vs command-center-views.ts, and for the same
// reason: ./founder-profile pulls in the DB client and must never be value-imported
// from a client component.

export interface FounderAnswers {
  // ── How they work ────────────────────────────────────────────────────────────
  name?: string;             // what to call them
  bio?: string;              // who they are, what they run
  working_hours?: string;    // when they work, when not to disturb, timezone
  communication?: string;    // how to reach them, expected response times
  writing_style?: string;    // how they write — so drafts sound like them
  decisions?: string;        // how they decide, what they need in order to decide

  // ── Boundaries (the operationally critical ones) ──────────────────────────────
  approvals?: string;        // what the assistant may approve alone, and up to what spend
  escalation?: string;       // what must reach them immediately, no matter what
  never_delegate?: string;   // what they always do themselves

  // ── Context ──────────────────────────────────────────────────────────────────
  values?: string;           // what matters to them
  relationships?: string;    // key people: partner, family, business partners
  family?: string;           // family context worth knowing

  // ── Preferences ──────────────────────────────────────────────────────────────
  travel?: string;           // airlines, seat, hotels, how they like to travel
  health?: string;           // routines, dietary needs, standing appointments
  personal?: string;         // anything else — coffee order to pet peeves
}

/** Field order + labels. One list drives the form, the rendered brief and the
 *  completeness meter, so they can never disagree. */
export const FOUNDER_FIELDS: ReadonlyArray<{
  key: keyof FounderAnswers;
  label: string;
  group: 'How they work' | 'Boundaries' | 'Context' | 'Preferences';
  placeholder: string;
  /** Boundaries are what an assistant gets wrong most expensively, so they count
   *  toward "ready" and the rest is enrichment. */
  essential?: boolean;
}> = [
  { key: 'name', group: 'How they work', label: 'What to call them', essential: true,
    placeholder: 'Mitch' },
  { key: 'bio', group: 'How they work', label: 'Who they are', essential: true,
    placeholder: 'Founder & CEO. Runs KeyPlayers plus a mortgage business.' },
  { key: 'working_hours', group: 'How they work', label: 'Working hours', essential: true,
    placeholder: 'Mon–Fri 8am–6pm ET. Never book before 9am. Fridays are for deep work.' },
  { key: 'communication', group: 'How they work', label: 'How to reach them', essential: true,
    placeholder: 'Text for anything urgent. Email for everything else — replies within a day.' },
  { key: 'writing_style', group: 'How they work', label: 'How they write',
    placeholder: 'Short sentences. Direct. No corporate speak. Never uses em dashes.' },
  { key: 'decisions', group: 'How they work', label: 'How they decide',
    placeholder: 'Wants a recommendation, not options. Will ask for reasoning if needed.' },

  { key: 'approvals', group: 'Boundaries', label: 'What the assistant can approve alone', essential: true,
    placeholder: 'Anything under $500. Travel within existing plans. Rescheduling internal meetings.' },
  { key: 'escalation', group: 'Boundaries', label: 'What must always reach them', essential: true,
    placeholder: 'Anything from a client, anything legal, any spend over $500.' },
  { key: 'never_delegate', group: 'Boundaries', label: 'What they always do themselves',
    placeholder: 'Final hiring calls. Anything sent to investors.' },

  { key: 'values', group: 'Context', label: 'What matters to them',
    placeholder: 'Speed over perfection. Being present at home.' },
  { key: 'relationships', group: 'Context', label: 'Key people',
    placeholder: 'Olivia (partner, co-leads the business). Brayson (CTO).' },
  { key: 'family', group: 'Context', label: 'Family context',
    placeholder: 'Protect weekends. Family dinner is 6pm — nothing booked over it.' },

  { key: 'travel', group: 'Preferences', label: 'Travel',
    placeholder: 'Aisle seat, direct where possible. Prefers the same hotel chain.' },
  { key: 'health', group: 'Preferences', label: 'Health & routine',
    placeholder: 'Gym 6–7am daily. No dairy. Physio every second Tuesday.' },
  { key: 'personal', group: 'Preferences', label: 'Anything else',
    placeholder: 'Flat white, no sugar. Hates surprise calls.' },
];

const ESSENTIAL_KEYS = FOUNDER_FIELDS.filter((f) => f.essential).map((f) => f.key);

export interface FounderProfile {
  answers: FounderAnswers | null;
  markdown: string | null;
  updated_at: string | null;
}

function clean(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** Keep only known keys with non-empty string values — a hand-edited profile blob can
 *  never introduce a bogus field into the prompt. */
export function sanitizeAnswers(input: Record<string, unknown>): FounderAnswers {
  const out: FounderAnswers = {};
  for (const f of FOUNDER_FIELDS) {
    const v = clean(input[f.key]);
    if (v !== undefined) out[f.key] = v;
  }
  return out;
}

/** How complete the profile is: filled essentials, and whether it's usable at all. */
export function completeness(answers: FounderAnswers | null): {
  filled: number; total: number; essentialsFilled: number; essentialsTotal: number; ready: boolean;
} {
  const a = answers ?? {};
  const filled = FOUNDER_FIELDS.filter((f) => clean(a[f.key])).length;
  const essentialsFilled = ESSENTIAL_KEYS.filter((k) => clean(a[k])).length;
  return {
    filled,
    total: FOUNDER_FIELDS.length,
    essentialsFilled,
    essentialsTotal: ESSENTIAL_KEYS.length,
    ready: essentialsFilled === ESSENTIAL_KEYS.length,
  };
}

/** Render the profile to markdown, verbatim — no model in the loop (see header). */
export function renderFounderBrief(answers: FounderAnswers): string {
  const groups = ['How they work', 'Boundaries', 'Context', 'Preferences'] as const;
  const parts: string[] = [];
  for (const g of groups) {
    const lines = FOUNDER_FIELDS
      .filter((f) => f.group === g && clean(answers[f.key]))
      .map((f) => `- **${f.label}:** ${answers[f.key]}`);
    if (lines.length) parts.push(`## ${g}\n${lines.join('\n')}`);
  }
  return parts.join('\n\n');
}

