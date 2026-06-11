// Company playbook — the single source of business context every agent runs with.
//
// Until now sub-agents got NO company context: loadSubAgentSystemPrompt only loads
// the agent's soul/agent/skills. So agents didn't know the user's objectives, ICP,
// voice, or constraints unless it was hand-typed into a task. The playbook fixes
// that: a short questionnaire generates a tight markdown brief that we (a) store on
// the tenant and (b) prepend to every agent's system prompt + the orchestrator's.
//
// Stored on tenants.business_profile (jsonb) under `playbook` (the rendered markdown)
// and `playbook_answers` (the raw questionnaire answers, so it can be regenerated/
// edited). No new table — business_profile already exists and is tenant-scoped.

import { sql, tenantId, jsonb } from './db/client';

export interface PlaybookAnswers {
  business?: string;     // what the company does
  objective?: string;    // primary objective right now
  audience?: string;     // ideal customer / ICP
  value?: string;        // core value proposition / differentiation
  channels?: string;     // primary marketing channels
  voice?: string;        // brand voice / tone
  constraints?: string;  // hard no-gos / compliance / off-limits
}

export interface CompanyPlaybook {
  markdown: string | null;
  answers: PlaybookAnswers | null;
  updated_at: string | null;
}

function readProfile(profile: Record<string, unknown> | null): CompanyPlaybook {
  const pb = profile?.playbook;
  const ans = profile?.playbook_answers;
  return {
    markdown: typeof pb === 'string' && pb.trim() ? pb : null,
    answers: ans && typeof ans === 'object' ? (ans as PlaybookAnswers) : null,
    updated_at: typeof profile?.playbook_updated_at === 'string' ? profile.playbook_updated_at : null,
  };
}

/** The current tenant's saved playbook (markdown + raw answers), or empty. */
export async function getCompanyPlaybook(): Promise<CompanyPlaybook> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  return readProfile(rows[0]?.business_profile ?? null);
}

/** Just the markdown, for injection into agent prompts. Null when not set up yet.
 *  Best-effort — never throws, so a context-load failure can't break an agent run. */
export async function getCompanyPlaybookMarkdown(): Promise<string | null> {
  try {
    return (await getCompanyPlaybook()).markdown;
  } catch {
    return null;
  }
}

/** A ready-to-prepend system-prompt block, or '' when there's no playbook. Kept
 *  compact + clearly delimited so it frames the agent without dominating its soul. */
export async function companyContextBlock(): Promise<string> {
  const md = await getCompanyPlaybookMarkdown();
  if (!md) return '';
  return `# Company playbook (the business you work for — honor this in everything you produce)\n\n${md.trim()}\n\n---\n`;
}

/** Persist the generated/edited playbook onto business_profile (merge, don't clobber
 *  the rest of the profile). nowIso is passed in because Date.now() isn't available
 *  to some callers; the API route stamps it. */
export async function saveCompanyPlaybook(markdown: string, answers: PlaybookAnswers, nowIso: string): Promise<void> {
  await sql()`
    UPDATE public.tenants
    SET business_profile = COALESCE(business_profile, '{}'::jsonb)
      || ${jsonb({ playbook: markdown, playbook_answers: answers, playbook_updated_at: nowIso })}
    WHERE id = ${tenantId()}
  `;
}
