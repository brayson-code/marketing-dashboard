// What Client Success actually captures on the onboarding call — PURE.
//
// Deliberately NOT every field in the founder profile. A capture form long enough to be
// complete is a form nobody finishes mid-call, and the remaining fields are exactly the
// ones the client is better placed to answer themselves on day one. These are the ones
// a person naturally says out loud when describing their business and how they work.
//
// Ordering follows the shape of a real call: the business first, then the person, then
// the boundaries. Boundaries land last on purpose — they are the most valuable answers
// and the hardest to ask for cold.

export const CAPTURE_FOUNDER_KEYS = [
  'name', 'bio', 'working_hours', 'communication', 'decisions',
  'assistant_role', 'approvals', 'escalation', 'never_delegate', 'relationships',
] as const;

export const CAPTURE_PLAYBOOK_KEYS = [
  'business', 'objective', 'audience', 'value', 'channels', 'voice', 'constraints',
] as const;

export interface CaptureField {
  key: string;
  /** Which store it lands in. */
  store: 'founder' | 'playbook';
  label: string;
  /** What to actually ask on the call, in the words you would use. */
  ask: string;
  section: 'The business' | 'The person' | 'Boundaries';
  /** Agents behave noticeably worse without these. */
  essential?: boolean;
  long?: boolean;
}

export const CAPTURE_FIELDS: CaptureField[] = [
  // ── The business ──────────────────────────────────────────────────────────
  { key: 'business', store: 'playbook', section: 'The business', essential: true, long: true,
    label: 'What the business does',
    ask: 'In your own words, what does the business do and who for?' },
  { key: 'objective', store: 'playbook', section: 'The business', essential: true,
    label: 'What they are trying to do right now',
    ask: 'What are you actually trying to move in the next quarter?' },
  { key: 'audience', store: 'playbook', section: 'The business',
    label: 'Who they sell to',
    ask: 'Who is the ideal customer? Who do you not want?' },
  { key: 'value', store: 'playbook', section: 'The business',
    label: 'Why people buy from them',
    ask: 'Why do people choose you over the alternative?' },
  { key: 'channels', store: 'playbook', section: 'The business',
    label: 'Where the work happens',
    ask: 'Where does business actually come from today?' },
  { key: 'voice', store: 'playbook', section: 'The business',
    label: 'How they sound',
    ask: 'How should anything written on your behalf sound?' },
  { key: 'constraints', store: 'playbook', section: 'The business',
    label: 'Off limits',
    ask: 'Anything we must never do, say, or touch? Compliance, competitors, topics?' },

  // ── The person ────────────────────────────────────────────────────────────
  { key: 'name', store: 'founder', section: 'The person', essential: true,
    label: 'What to call them',
    ask: 'What should your assistant call you?' },
  { key: 'bio', store: 'founder', section: 'The person', essential: true, long: true,
    label: 'Who they are',
    ask: 'What is your role day to day, and what do you actually spend time on?' },
  { key: 'working_hours', store: 'founder', section: 'The person', essential: true,
    label: 'Their hours',
    ask: 'What hours do you work, and what timezone? When are you off limits?' },
  { key: 'communication', store: 'founder', section: 'The person', essential: true,
    label: 'How to reach them',
    ask: 'Best way to reach you for something urgent? And for something that can wait?' },
  { key: 'decisions', store: 'founder', section: 'The person',
    label: 'How they decide',
    ask: 'When you need to make a call, what do you want to see first?' },
  { key: 'relationships', store: 'founder', section: 'The person',
    label: 'People who matter',
    ask: 'Who should never be treated as routine? Clients, partners, family?' },

  // ── Boundaries ────────────────────────────────────────────────────────────
  { key: 'assistant_role', store: 'founder', section: 'Boundaries', long: true,
    label: 'What the assistant will own',
    ask: 'What do you want off your plate first?' },
  { key: 'approvals', store: 'founder', section: 'Boundaries', essential: true, long: true,
    label: 'What they can approve alone',
    ask: 'What can your assistant just handle without asking? Any spend limit?' },
  { key: 'escalation', store: 'founder', section: 'Boundaries', essential: true, long: true,
    label: 'What must always reach them',
    ask: 'What must always come to you, no matter what?' },
  { key: 'never_delegate', store: 'founder', section: 'Boundaries',
    label: 'What they always do themselves',
    ask: 'What will you always want to do yourself?' },
];

export const CAPTURE_SECTIONS = ['The business', 'The person', 'Boundaries'] as const;

export const SECTION_BLURB: Record<(typeof CAPTURE_SECTIONS)[number], string> = {
  'The business': 'Goes into the company playbook every agent reads.',
  'The person': 'Goes into the founder profile, which is prepended to every agent prompt.',
  'Boundaries': 'The expensive ones to get wrong. Agents treat these as binding, so use their words, not a paraphrase.',
};
