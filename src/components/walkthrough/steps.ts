import {
  CreditCard, KeyRound, Bot, Target, BookText, Share2, BarChart3, Eye, UserPlus,
  type LucideIcon,
} from 'lucide-react';

// The setup walkthrough is COMPLETION-DRIVEN: each step's `id` is a signal key
// returned by GET /api/setup-status. A step's coachmark/checklist row shows until
// that signal flips true, then auto-retires — no per-step bookkeeping to drift.

export type SignalKey =
  | 'plan_set'
  | 'claude_key'
  | 'execs_enabled'
  | 'goals'
  | 'playbook'
  | 'socials'
  | 'integrations'
  | 'competitor_watch'
  | 'teammate';

export interface WalkthroughStep {
  id: SignalKey;
  title: string;
  body: string;
  icon: LucideIcon;
  cta: { label: string; href: string };
  required: boolean;
  /** Pathnames where this step's coachmark anchors (nav-rail prefix semantics).
   *  Empty → checklist-only (no on-tab bubble). */
  routes: string[];
  /** data-walkthrough value of the element to point the bubble at. When the element
   *  isn't on the page, the bubble floats near the checklist instead. */
  anchor?: string;
  /** Emphasized warning line — used for the cost-bearing "enable execs" step so the
   *  user opts into Claude spend knowingly. */
  costNote?: string;
}

// Order = the setup sequence (and the checklist order). Required steps first.
// STEP ONE is the Anthropic key: nothing the AI team does works without it, and we
// no longer fall back to the platform key for client workspaces (strict BYO), so a
// workspace literally cannot run an agent until this is connected.
export const WALKTHROUGH_STEPS: WalkthroughStep[] = [
  {
    id: 'claude_key',
    title: 'Connect your Claude key',
    body: 'Step one — your AI team runs on your own Anthropic key, so your data and spend stay under your account. Agents stay paused until this is connected.',
    icon: KeyRound,
    cta: { label: 'Connect Claude', href: '/connections' },
    required: true,
    routes: ['/connections'],
    anchor: 'connect-claude',
  },
  {
    id: 'plan_set',
    title: 'Pick a plan',
    body: 'Choose a plan to unlock your workspace. You can change or cancel anytime.',
    icon: CreditCard,
    cta: { label: 'Choose a plan', href: '/billing' },
    required: true,
    routes: ['/billing'],
    anchor: 'billing-plan',
  },
  {
    id: 'execs_enabled',
    title: 'Turn on your AI executives',
    body: 'Your AI CEO, CMO, COO, CRO and CXO are seeded but paused. Enable them to start working on a schedule.',
    icon: Bot,
    cta: { label: 'Review & enable execs', href: '/cron' },
    required: true,
    routes: ['/cron'],
    anchor: 'enable-execs',
    costNote: 'Enabling starts scheduled runs that spend your connected Claude credits — so nothing costs you anything until you flip this on.',
  },
  {
    id: 'goals',
    title: 'Set your first goal',
    body: 'Give your team a target. Goals orient what every agent works toward.',
    icon: Target,
    cta: { label: 'Set a goal', href: '/goals' },
    required: true,
    routes: ['/goals'],
    anchor: 'add-goal',
  },
  {
    id: 'playbook',
    title: 'Build your company playbook',
    body: 'Answer a few questions and we write a brief every agent reads first — so your AI team knows your objective, audience, and voice instead of sounding generic.',
    icon: BookText,
    cta: { label: 'Build playbook', href: '/memory' },
    required: true,
    routes: ['/memory'],
    anchor: 'playbook-tab',
  },
  {
    id: 'socials',
    title: 'Connect a social account',
    body: 'Link a channel so agents can publish and pull real performance numbers.',
    icon: Share2,
    cta: { label: 'Connect a channel', href: '/connections' },
    required: false,
    routes: [],
  },
  {
    id: 'integrations',
    title: 'Connect analytics & email',
    body: 'Add Google Analytics, Gmail or your email tool so reporting and outreach use real data.',
    icon: BarChart3,
    cta: { label: 'Add integrations', href: '/connections' },
    required: false,
    routes: [],
  },
  {
    id: 'competitor_watch',
    title: 'Watch a competitor',
    body: 'Optional: set up a daily competitor scan to feed your content engine.',
    icon: Eye,
    cta: { label: 'Set up competitor watch', href: '/competitors' },
    required: false,
    routes: [],
  },
  {
    id: 'teammate',
    title: 'Invite a teammate',
    body: 'Optional: bring a colleague into the workspace.',
    icon: UserPlus,
    cta: { label: 'Invite someone', href: '/settings' },
    required: false,
    routes: [],
  },
];

export type Signals = Record<SignalKey, boolean>;

/** A step is "active" (still needs doing) when its signal is false. */
export function isStepDone(signals: Signals | null, id: SignalKey): boolean {
  return !!signals?.[id];
}

/** nav-rail matching semantics: exact for '/', else prefix on a '/' boundary. */
export function routeMatches(routes: string[], pathname: string): boolean {
  return routes.some((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/')));
}
