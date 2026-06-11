// Autonomy gate — single source of truth for "what does the wizard's autonomy
// choice actually do?" The active level + per-draft-type overrides live in
// tenants.business_profile (jsonb) so we don't need another migration; the
// wizard already writes business_profile. Read-modify-write per request.
//
// Decision matrix used by gateOutbound(type) → 'execute' | 'draft' | 'block':
//   observe    → block (agents may NOT produce outbound work)
//   propose    → draft (everything queued for owner approval — today's de-facto behavior)
//   act_notify → per-type: overrides[type]==='auto' AND type has an executor → execute,
//                otherwise → draft. Default override = 'approve' (safe).
//   full_auto  → execute when an executor exists; otherwise → draft (nothing to run).
//
// Types without an executor (campaign, other) can never auto-execute — they're
// always drafts regardless of mode, because there's no concrete action to take.

import { sql, jsonb, tenantId } from './db/client';
import type { DraftType } from './drafts';

export type Autonomy = 'observe' | 'propose' | 'act_notify' | 'full_auto';
export type Decision = 'execute' | 'draft' | 'block';
export type OverrideValue = 'auto' | 'approve';

export const AUTONOMY_LEVELS: Autonomy[] = ['observe', 'propose', 'act_notify', 'full_auto'];

/** Per-type metadata for the UI + the gate. `hasExecutor` controls whether a
 *  type is auto-executable at all (campaign/other have no executor in drafts.ts). */
export const DRAFT_TYPE_META: Array<{
  type: DraftType; label: string; description: string; hasExecutor: boolean; defaultOverride: OverrideValue;
}> = [
  { type: 'content_post', label: 'Social post',     description: 'Posts to IG/FB/LinkedIn/YouTube/X/TikTok.',     hasExecutor: true,  defaultOverride: 'auto'    },
  { type: 'email',        label: 'Outreach email',  description: 'Cold or warm outreach emails to leads.',         hasExecutor: true,  defaultOverride: 'approve' },
  { type: 'meeting',      label: 'Meeting confirm', description: 'Calendar confirmations on the owner’s behalf.', hasExecutor: true,  defaultOverride: 'approve' },
  { type: 'campaign',     label: 'Campaign',        description: 'New campaign plans — always queued for approval.', hasExecutor: false, defaultOverride: 'approve' },
  { type: 'other',        label: 'Other',           description: 'Anything else — always queued for approval.',     hasExecutor: false, defaultOverride: 'approve' },
];

export interface AutonomyConfig {
  level: Autonomy;
  overrides: Partial<Record<DraftType, OverrideValue>>;
}

/** Sentinel thrown by createDraft when autonomy is 'observe' (outbound blocked). */
export class AutonomyBlockedError extends Error {
  code = 'AUTONOMY_BLOCKED' as const;
  constructor(public type: DraftType) {
    super(`Autonomy mode 'observe' blocks creating a ${type} draft.`);
  }
}

/** Read the active tenant's autonomy config from tenants.business_profile.
 *  Defaults to { level: 'propose', overrides: {} } when nothing is set yet. */
export async function getAutonomyConfig(): Promise<AutonomyConfig> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = rows[0]?.business_profile ?? {};
  const level = isAutonomy(bp.autonomy) ? bp.autonomy : 'propose';
  const overrides = (bp.autonomy_overrides && typeof bp.autonomy_overrides === 'object')
    ? bp.autonomy_overrides as Partial<Record<DraftType, OverrideValue>>
    : {};
  return { level, overrides };
}

/** Patch autonomy fields without clobbering the rest of business_profile. */
export async function setAutonomyConfig(patch: Partial<AutonomyConfig>): Promise<AutonomyConfig> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
  if (patch.level !== undefined) {
    if (!isAutonomy(patch.level)) throw new Error(`Invalid autonomy level: ${patch.level}`);
    bp.autonomy = patch.level;
  }
  if (patch.overrides !== undefined) {
    const clean: Record<string, OverrideValue> = {};
    for (const [k, v] of Object.entries(patch.overrides)) {
      if (v === 'auto' || v === 'approve') clean[k] = v;
    }
    bp.autonomy_overrides = clean;
  }
  await sql()`
    UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
  `;
  return getAutonomyConfig();
}

/** The decision used by createDraft. Pure function of (config, type) — easy to test. */
export function decide(config: AutonomyConfig, type: DraftType): Decision {
  const meta = DRAFT_TYPE_META.find((m) => m.type === type);
  const hasExecutor = meta?.hasExecutor ?? false;
  switch (config.level) {
    case 'observe':   return 'block';
    case 'propose':   return 'draft';
    case 'full_auto': return hasExecutor ? 'execute' : 'draft';
    case 'act_notify': {
      const override = config.overrides[type] ?? meta?.defaultOverride ?? 'approve';
      return override === 'auto' && hasExecutor ? 'execute' : 'draft';
    }
  }
}

/** Convenience: read the live config then decide. Used by createDraft. */
export async function gateOutbound(type: DraftType): Promise<{ decision: Decision; config: AutonomyConfig }> {
  const config = await getAutonomyConfig();
  return { decision: decide(config, type), config };
}

function isAutonomy(v: unknown): v is Autonomy {
  return typeof v === 'string' && (AUTONOMY_LEVELS as string[]).includes(v);
}
