// Command Center view gate (SERVER) — reads/writes "which client-facing nav views are
// enabled for this workspace". The enabled-views map lives in
// tenants.business_profile.command_center_views (jsonb) so we don't need another
// migration; settings/onboarding already write business_profile. Read-modify-write per
// request, exactly like src/lib/autonomy.ts.
//
// The PURE catalog (VIEW_SECTIONS, PRESETS, the validation allow-list, sanitizer) lives
// in ./command-center-catalog so both this server module AND the client Settings panel
// can share ONE source with no drift. We re-export those here so existing server-side
// importers (the /api/command-center/views route) keep importing from one place.

import { sql, jsonb, tenantId } from './db/client';
import {
  type EnabledViews,
  VIEW_SECTIONS,
  TOGGLEABLE_HREFS,
  TOGGLEABLE_SET,
  PRESETS,
  sanitizeEnabledViews,
  isViewOn,
} from './command-center-catalog';

// Re-export the pure catalog so server consumers can import everything from this module.
export { VIEW_SECTIONS, TOGGLEABLE_HREFS, TOGGLEABLE_SET, PRESETS, isViewOn };
export type { EnabledViews };

/** Read the active tenant's enabled-views map from tenants.business_profile.
 *  Returns {} when nothing is set yet — and {} means ALL-ON (every view shown). */
export async function getEnabledViews(): Promise<EnabledViews> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = rows[0]?.business_profile ?? {};
  const raw = bp.command_center_views;
  if (!raw || typeof raw !== 'object') return {};
  // Sanitize what we read back too: drop unknown/non-toggleable keys and coerce values
  // to boolean, so a hand-edited profile can never surface a bogus key.
  return sanitizeEnabledViews(raw as Record<string, unknown>);
}

/** Patch the enabled-views map without clobbering the rest of business_profile.
 *  Mirrors src/lib/autonomy.ts: SELECT business_profile, merge, UPDATE WHERE id.
 *  Unknown keys are dropped; values are coerced to boolean; "/issues", "/security",
 *  "/" and "/settings" are NEVER accepted (they're not in TOGGLEABLE_HREFS). */
export async function setEnabledViews(patch: Record<string, boolean>): Promise<EnabledViews> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
  const current = (bp.command_center_views && typeof bp.command_center_views === 'object')
    ? sanitizeEnabledViews(bp.command_center_views as Record<string, unknown>)
    : {};
  const merged: EnabledViews = { ...current, ...sanitizeEnabledViews(patch) };
  bp.command_center_views = merged;
  await sql()`
    UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
  `;
  return getEnabledViews();
}
