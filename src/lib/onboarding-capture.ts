// Onboarding call capture — SERVER. HQ-gated callers only.
//
// THE PROBLEM THIS SOLVES: 0 of 14 production workspaces have a founder profile. The
// form isn't the issue. Nobody fills in a blank form after they have already told a
// human everything, and Client Success takes all of this down on the onboarding call
// anyway. So the call writes the profile, and on day one the client CONFIRMS AND
// CORRECTS instead of authoring from nothing.
//
// It deliberately writes to the EXISTING stores — business_profile.founder and
// .playbook_answers — rather than a parallel "capture" table. Same rows the client's
// setup wizard reads and writes, so there is one source of truth and nothing to
// reconcile. The only new thing recorded is who captured it and when, which is what
// lets the client's wizard say "your KeyPlayers team filled this in, check it's right".

import { sql, jsonb } from './db/client';
import { getFounderProfile, saveFounderProfile } from './founder-profile';
import { getCompanyPlaybook, savePlaybookAnswers, type PlaybookAnswers } from './company-playbook';
import { FOUNDER_FIELDS, type FounderAnswers } from './founder-profile-catalog';
import { CAPTURE_FOUNDER_KEYS, CAPTURE_PLAYBOOK_KEYS } from './onboarding-capture-catalog';

export interface CaptureState {
  founder: FounderAnswers;
  playbook: PlaybookAnswers;
  captured_by: string | null;
  captured_at: string | null;
  /** Of the fields worth getting on a call, how many have something in them. */
  filled: number;
  total: number;
  /** The essentials specifically — agents behave badly without these. */
  essentialsFilled: number;
  essentialsTotal: number;
}

const ESSENTIAL_FOUNDER = new Set(
  FOUNDER_FIELDS.filter(f => f.essential).map(f => f.key as string),
);

function countFilled(obj: Record<string, unknown>, keys: readonly string[]) {
  return keys.filter(k => String(obj?.[k] ?? '').trim().length > 0).length;
}

export async function getCapture(target: string): Promise<CaptureState> {
  const [profile, playbook, rows] = await Promise.all([
    getFounderProfile(target),
    getCompanyPlaybook(target),
    sql()`SELECT business_profile FROM public.tenants WHERE id = ${target} LIMIT 1`,
  ]);

  const bp = ((rows as unknown as Array<{ business_profile: Record<string, unknown> | null }>)[0]
    ?.business_profile ?? {}) as Record<string, unknown>;
  const mark = (bp.onboarding_capture ?? {}) as Record<string, unknown>;

  const founder = (profile.answers ?? {}) as FounderAnswers;
  const answers = (playbook.answers ?? {}) as PlaybookAnswers;

  const founderFilled = countFilled(founder as Record<string, unknown>, CAPTURE_FOUNDER_KEYS);
  const playbookFilled = countFilled(answers as Record<string, unknown>, CAPTURE_PLAYBOOK_KEYS);

  const essentialKeys = CAPTURE_FOUNDER_KEYS.filter(k => ESSENTIAL_FOUNDER.has(k));

  return {
    founder,
    playbook: answers,
    captured_by: typeof mark.by === 'string' ? mark.by : null,
    captured_at: typeof mark.at === 'string' ? mark.at : null,
    filled: founderFilled + playbookFilled,
    total: CAPTURE_FOUNDER_KEYS.length + CAPTURE_PLAYBOOK_KEYS.length,
    essentialsFilled: countFilled(founder as Record<string, unknown>, essentialKeys),
    essentialsTotal: essentialKeys.length,
  };
}

/**
 * Write what the call produced.
 *
 * MERGES rather than replaces, for two reasons: Client Success saves partway through a
 * call and comes back to it, and a client may already have corrected something. An
 * empty field in the submission means "I didn't get this", not "delete what's there".
 */
export async function saveCapture(
  target: string,
  input: { founder?: Partial<FounderAnswers>; playbook?: Partial<PlaybookAnswers> },
  by: string | null,
  nowIso: string,
): Promise<CaptureState> {
  const current = await getCapture(target);

  const founder: FounderAnswers = { ...current.founder };
  for (const k of CAPTURE_FOUNDER_KEYS) {
    const v = (input.founder as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'string' && v.trim()) (founder as Record<string, unknown>)[k] = v.trim();
  }

  const playbook: PlaybookAnswers = { ...current.playbook };
  for (const k of CAPTURE_PLAYBOOK_KEYS) {
    const v = (input.playbook as Record<string, unknown> | undefined)?.[k];
    if (typeof v === 'string' && v.trim()) (playbook as Record<string, unknown>)[k] = v.trim();
  }

  // saveFounderProfile also re-renders the brief that every agent prompt reads, so the
  // capture reaches the agents without a second step.
  await saveFounderProfile(founder, nowIso, target);
  await savePlaybookAnswers(playbook, nowIso, target);

  await sql()`
    UPDATE public.tenants
    SET business_profile = COALESCE(business_profile, '{}'::jsonb)
      || ${jsonb({ onboarding_capture: { by, at: nowIso } })}
    WHERE id = ${target}
  `;

  return getCapture(target);
}
