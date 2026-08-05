// Founder profile (SERVER) — reads/writes the profile and builds the prompt block.
// Pulls in the DB client, so NEVER value-import this from a client component; the pure
// catalog (fields, types, sanitize, completeness, renderFounderBrief) lives in
// ./founder-profile-catalog and is re-exported here so server callers have one import.
//
// See ./founder-profile-catalog for why the brief is rendered verbatim, with no model
// in the loop: approval limits and escalation rules must not be paraphrased.

import { sql, tenantId, jsonb } from './db/client';
import {
  type FounderAnswers,
  type FounderProfile,
  sanitizeAnswers,
  renderFounderBrief,
} from './founder-profile-catalog';

export * from './founder-profile-catalog';

/**
 * `target` lets an HQ operator read/write ANOTHER workspace's profile — the onboarding
 * capture, where Client Success fills this in on the call rather than the client filling
 * a blank form later. Callers passing a target MUST be requireHq()-gated; omitting it
 * keeps the original tenantId()-scoped behaviour for every existing call site.
 */
export async function getFounderProfile(target?: string): Promise<FounderProfile> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${target ?? tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = rows[0]?.business_profile ?? {};
  const raw = bp.founder;
  const answers = raw && typeof raw === 'object'
    ? sanitizeAnswers(raw as Record<string, unknown>)
    : null;
  return {
    answers,
    markdown: typeof bp.founder_brief === 'string' && bp.founder_brief.trim() ? bp.founder_brief : null,
    updated_at: typeof bp.founder_updated_at === 'string' ? bp.founder_updated_at : null,
  };
}

/** Merge onto business_profile — never clobber the playbook, autonomy or views. */
export async function saveFounderProfile(answers: FounderAnswers, nowIso: string, target?: string): Promise<FounderProfile> {
  const markdown = renderFounderBrief(answers);
  await sql()`
    UPDATE public.tenants
    SET business_profile = COALESCE(business_profile, '{}'::jsonb)
      || ${jsonb({ founder: answers, founder_brief: markdown, founder_updated_at: nowIso })}
    WHERE id = ${target ?? tenantId()}
  `;
  return { answers, markdown: markdown || null, updated_at: nowIso };
}

/**
 * The system-prompt block, prepended alongside the company playbook so EVERY agent and
 * the orchestrator run knowing the person, not just the business. Empty string when the
 * profile hasn't been filled in — behaviour is unchanged until someone sets it up.
 * Best-effort: never throws, so a context-load failure can't break an agent run.
 */
export async function founderContextBlock(): Promise<string> {
  try {
    const { markdown } = await getFounderProfile();
    if (!markdown) return '';
    return `# The founder you work for (how THIS person operates — follow it exactly)\n\n${markdown.trim()}\n\nTreat the Boundaries section as binding: never exceed a stated approval limit, and always escalate what they've said must reach them.\n\n---\n`;
  } catch {
    return '';
  }
}
