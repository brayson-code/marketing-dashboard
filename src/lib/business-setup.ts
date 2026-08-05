// Business Setup — the stepped wizard behind /business-setup.
//
// WHY IT EXISTS: 0 of 14 production workspaces had a Founder Profile filled in. The
// onboarding walkthrough asks these questions once and then retires, and there was no
// way back to them — so the single highest-leverage thing in the product (the profile
// every agent reads before it does anything) sat empty everywhere. This is the way in,
// and the way back.
//
// IT WRITES TO EXISTING STORAGE, NOT ITS OWN. Each step targets the place that already
// owns that data — the Founder Profile or the company playbook. Building a third home
// for "your name" would have given us three copies that disagree, and the one the
// agents actually read might be the one nobody updated.
//
// PURE data (no sql, no React) so the copy is reviewable in one place and the file is
// safe in the client bundle.

/** Which existing store a step writes to. */
export type SetupTarget = 'founder' | 'playbook';

export interface SetupField {
  /** Key in the target store — a FounderAnswers key or a PlaybookAnswers key. */
  key: string;
  label: string;
  placeholder: string;
  /** Long answers get a textarea; short ones a single line. */
  long?: boolean;
}

export interface SetupStep {
  id: string;
  title: string;
  blurb: string;
  target: SetupTarget;
  fields: SetupField[];
  /** Shown under the step when there's something worth stressing. */
  note?: string;
}

// Six steps. The reference had eight, including CODE, STACK and an Obsidian-vault
// env-var block — that's the reference author's own dev tooling and has no business in
// front of a founder or an assistant, so those are gone.
export const SETUP_STEPS: SetupStep[] = [
  {
    id: 'operator',
    title: 'You',
    blurb: 'Who runs this business. Every AI agent reads this before it does anything.',
    target: 'founder',
    fields: [
      { key: 'name', label: 'Your name', placeholder: 'Mitch' },
      { key: 'bio', label: 'What you do', placeholder: 'Founder & CEO. Runs KeyPlayers plus a mortgage business.', long: true },
      { key: 'working_hours', label: 'Working hours', placeholder: 'Mon–Fri 8am–6pm ET. Never book before 9am.', long: true },
      { key: 'communication', label: 'How to reach you', placeholder: 'Text for anything urgent. Email for everything else.', long: true },
    ],
  },
  {
    id: 'assistant',
    title: 'Your assistant',
    blurb: 'Who supports you day to day. Their name shows up across the Command Centre.',
    target: 'founder',
    fields: [
      { key: 'assistant_name', label: "Executive Assistant's name", placeholder: 'Jervis' },
      { key: 'assistant_role', label: 'What they own', placeholder: 'Inbox, calendar, travel, follow-ups', long: true },
    ],
  },
  {
    id: 'boundaries',
    title: 'Boundaries',
    blurb: 'The expensive ones to get wrong. Agents treat these as binding rules.',
    target: 'founder',
    note: 'Nothing that sends, publishes or spends will happen outside these limits.',
    fields: [
      { key: 'approvals', label: 'What your assistant can approve alone', placeholder: 'Anything under $500. Travel within existing plans.', long: true },
      { key: 'escalation', label: 'What must always reach you', placeholder: 'Anything from a client, anything legal, any spend over $500.', long: true },
      { key: 'never_delegate', label: 'What you always do yourself', placeholder: 'Final hiring calls. Anything sent to investors.', long: true },
    ],
  },
  {
    id: 'business',
    title: 'Your business',
    blurb: 'What the company does and what it is driving at right now.',
    target: 'playbook',
    fields: [
      { key: 'business', label: 'What the business does', placeholder: 'We place trained Executive Assistants with founders.', long: true },
      { key: 'objective', label: 'Your #1 objective right now', placeholder: 'Get to 100 active clients without hiring more ops staff.', long: true },
      { key: 'audience', label: 'Your ideal customer', placeholder: 'Founder-led businesses doing $2M+ with a small team.', long: true },
    ],
  },
  {
    id: 'offer',
    title: 'Your offer',
    blurb: 'What you sell and why people choose you over the alternative.',
    target: 'playbook',
    fields: [
      { key: 'value', label: 'What makes you different', placeholder: 'Trained assistants plus an AI system, not a job board.', long: true },
      { key: 'constraints', label: 'Hard no-gos', placeholder: 'Never discount. Never promise timelines we cannot hold.', long: true },
    ],
  },
  {
    id: 'voice',
    title: 'Voice & channels',
    blurb: 'How you sound and where you show up. Agents write in this voice.',
    target: 'playbook',
    fields: [
      { key: 'voice', label: 'How you sound', placeholder: 'Direct. Short sentences. No corporate speak. No em dashes.', long: true },
      { key: 'channels', label: 'Where you show up', placeholder: 'LinkedIn, YouTube, email newsletter.', long: true },
    ],
  },
];

/** Which fields on a step have been answered — drives the per-step tick and the meter. */
export function stepFilled(step: SetupStep, values: Record<string, string>): number {
  return step.fields.filter((f) => (values[f.key] ?? '').trim()).length;
}

export function stepComplete(step: SetupStep, values: Record<string, string>): boolean {
  return stepFilled(step, values) === step.fields.length;
}

/** Overall progress across every step. */
export function setupProgress(values: Record<string, string>): { filled: number; total: number; pct: number } {
  const total = SETUP_STEPS.reduce((s, st) => s + st.fields.length, 0);
  const filled = SETUP_STEPS.reduce((s, st) => s + stepFilled(st, values), 0);
  return { filled, total, pct: total === 0 ? 0 : Math.round((filled / total) * 100) };
}
