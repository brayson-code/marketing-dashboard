// What each person should do first — PURE.
//
// The client and the assistant open the same workspace on day one and need different
// things from it. The client has to confirm what Client Success captured. The assistant
// has to learn the business and chase whatever is still blank.
//
// One shared truth ("the profile is incomplete"), two readings of it. Keeping the
// decision here rather than in the component means the copy can be tested, and there is
// exactly one place that decides whether anyone is nagged at all.

import { FOUNDER_FIELDS, type FounderAnswers } from './founder-profile-catalog';
import { CAPTURE_FIELDS } from './onboarding-capture-catalog';

export type Viewer = 'owner' | 'member' | 'va';

export interface FirstRunCard {
  tone: 'prompt' | 'confirm' | 'refresh';
  title: string;
  body: string;
  /** Concrete things still unanswered, phrased for whoever is reading. */
  items: string[];
  ctaLabel: string;
  ctaHref: string;
}

/** The question Client Success would ask for a field, when we have one written. */
const ASK_BY_KEY = new Map(CAPTURE_FIELDS.map(f => [f.key, f.ask]));

function missingEssentials(answers: FounderAnswers) {
  return FOUNDER_FIELDS.filter(
    f => f.essential && !String((answers as Record<string, unknown>)?.[f.key] ?? '').trim(),
  );
}

/** After this long untouched, boundaries are worth re-confirming rather than trusted. */
export const STALE_PROFILE_DAYS = 90;

/**
 * What to show at the top of the Overview, or null to show nothing.
 *
 * Returns null the moment the essentials are answered AND the profile is recent. A
 * prompt that never goes away stops being read, and worse, teaches people that the app
 * nags regardless of whether they have done the thing.
 */
export function firstRunCard(input: {
  viewer: Viewer;
  answers: FounderAnswers;
  /** Set when Client Success filled this in on the onboarding call. */
  captured: boolean;
  /** How the founder wants to be addressed, when known. */
  founderName?: string | null;
  /** When the profile was last saved, and the clock. Both needed for the decay nudge. */
  updatedAt?: string | null;
  now?: number;
}): FirstRunCard | null {
  const missing = missingEssentials(input.answers);
  const who = input.founderName?.trim();

  // ── The assistant ─────────────────────────────────────────────────────────
  if (input.viewer === 'va') {
    if (missing.length === 0) return null;
    return {
      tone: 'prompt',
      title: who ? `Things to ask ${who}` : 'Things to ask your founder',
      body: 'Your agents work from these answers, so until they exist everything is a guess. These are worth getting in your first conversation.',
      // The assistant is going to ASK these out loud, so show the question rather than
      // the field name.
      items: missing.map(f => ASK_BY_KEY.get(f.key) ?? f.label),
      ctaLabel: 'Open the profile',
      ctaHref: '/founder',
    };
  }

  // ── The client ────────────────────────────────────────────────────────────
  // A captured profile with nothing missing still deserves one look, because it was
  // written down by someone else and the boundaries are binding on their agents.
  if (input.captured && missing.length === 0) {
    return {
      tone: 'confirm',
      title: 'Check what we wrote down',
      body: 'Your KeyPlayers team filled this in from your onboarding call. It is worth two minutes to check we got it right, especially what your assistant can approve without asking you.',
      items: [],
      ctaLabel: 'Review it',
      ctaHref: '/business-setup',
    };
  }

  if (missing.length === 0) {
    // ── Decay ───────────────────────────────────────────────────────────────
    // A complete profile is not a permanent one. Approval limits, working hours and
    // who matters all change, and agents treat every one of them as binding until
    // somebody says otherwise. Nothing else in the product ever asks again.
    const updated = input.updatedAt ? Date.parse(input.updatedAt) : NaN;
    if (Number.isFinite(updated) && typeof input.now === 'number') {
      const days = Math.floor((input.now - updated) / 86_400_000);
      if (days >= STALE_PROFILE_DAYS) {
        return {
          tone: 'refresh',
          title: 'Worth a look — this has not changed in a while',
          body: `Nothing here has been updated in ${Math.floor(days / 30)} months. Your agents treat these as binding, so it is worth checking that the approval limits and boundaries still match how you actually work.`,
          items: [],
          ctaLabel: 'Review it',
          ctaHref: who ? '/founder' : '/business-setup',
        };
      }
    }
    return null;
  }

  return input.captured
    ? {
        tone: 'confirm',
        title: 'Finish what we started',
        body: 'We captured most of this on your onboarding call. A few things are still blank, and your assistant and every agent work from them.',
        items: missing.map(f => f.label),
        ctaLabel: 'Finish it',
        ctaHref: '/business-setup',
      }
    : {
        tone: 'prompt',
        title: 'Your AI team does not know you yet',
        body: 'Every agent reads this before it does anything. Until it is filled in they are working from guesses about how you want things done.',
        items: missing.map(f => f.label),
        ctaLabel: 'Set it up',
        ctaHref: '/business-setup',
      };
}
