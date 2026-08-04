// Dashboard layout resolution + persistence (SERVER). Decides which widgets an Overview
// board shows, in what order, at what span — and writes those choices back. Two homes,
// NO new table / NO migration (exactly the command_center_views pattern):
//   • per-USER override  → workspace_members.preferences.dashboard_layout  (this teammate)
//   • per-TENANT default → tenants.business_profile.dashboard_layout        (whole workspace)
//
// Resolution precedence (first hit wins):
//   1. per-user layout   (source: 'user')     — this member customized their own board
//   2. per-tenant layout (source: 'tenant')   — the owner set a workspace default
//   3. industry template (source: 'industry') — e.g. landscaping/construction get an
//                                                ops-focused board with no content widgets
//   4. DEFAULT_TEMPLATE  (source: 'default')  — today's page, exactly (zero visual change)
//
// The PURE registry (widget defs, id validation) lives in ./dashboard-widgets so this
// server module AND the client board renderer share one source with no drift. This file
// pulls in the DB client, so it must NEVER be VALUE-imported from a client component;
// the layout TYPES below are safe to `import type { … }` (type-only imports are erased).

import { sql, jsonb, tenantId } from './db/client';
import { currentUserId } from './tenant';
import { WIDGET_ID_SET, type WidgetSpan } from './dashboard-widgets';

/** Bumped only if the persisted shape changes incompatibly. */
export const LAYOUT_VERSION = 1 as const;

/** One placed widget: its id, plus an optional span override (falls back to the
 *  registry defaultSpan when omitted). */
export interface LayoutWidget {
  id: string;
  span?: WidgetSpan;
}

/** The persisted layout blob (stored in jsonb, returned by the API). */
export interface DashboardLayout {
  version: typeof LAYOUT_VERSION;
  widgets: LayoutWidget[];
}

/** Where a resolved layout came from (for debugging + the settings UI). */
export type LayoutSource = 'user' | 'tenant' | 'industry' | 'default';

/** The industry keys that ship a curated template (a freeform industry string is
 *  normalized to one of these by industryTemplateKey). */
export type IndustryTemplateKey = 'landscaping' | 'construction';

// ─── Templates ─────────────────────────────────────────────────────────────────

function w(id: string, span: WidgetSpan): LayoutWidget {
  return { id, span };
}

function makeLayout(widgets: LayoutWidget[]): DashboardLayout {
  return { version: LAYOUT_VERSION, widgets };
}

// DEFAULT — the overview for unconfigured tenants. Historically this reproduced
// src/app/page.tsx region for region; it now leads with the Command Chat widget.
// INTENTIONAL DEFAULT CHANGE (owner's explicit call: the agent chat should be "on by
// default in every work space"): `agent_chat` is pinned as the FIRST widget (span 3) of
// every fresh/unconfigured overview. This does NOT touch tenants who saved their own
// layout — resolveLayout prefers a per-user or per-tenant layout over this template, so
// only unconfigured workspaces see the new default. (LensTabs is a board control, not a
// widget, so it isn't listed.) Spans are explicit so the contract can't silently drift
// if a registry defaultSpan is ever tuned.
// TRIMMED 2026-08-04 (Mitch's call): this was 14 widgets and read as "everything at
// once" — the single loudest complaint about the Command Centre. The Overview should
// answer one question for an Executive Assistant opening it in the morning: what does
// the founder need from me today? So the default now carries the daily-decision widgets
// only, and the marketing/analytics tiles (competitor_intel, content_lab, engagement,
// knowledge_map, automation_flow, usage) plus hero_agents come OFF the default board.
//
// Nothing was deleted: every one of them is still in the registry and one click away via
// Customize → the widget library. And this template only applies to workspaces that have
// NOT saved a layout — resolveLayout prefers a per-user or per-tenant layout, so no
// existing customised board changes.
export const DEFAULT_TEMPLATE: DashboardLayout = makeLayout([
  w('agent_chat', 3),
  w('kpi_strip', 3),
  w('quick_win', 3),
  w('operator_queue', 1),
  w('todays_priorities', 1),
  w('weekly_snapshot', 1),
  w('north_star', 3),
]);

// OPS-FOCUSED — for trades like landscaping/construction: KPIs, goals, the owner's
// queues, the team, active automations, spend. Deliberately NO content_lab /
// competitor_intel / engagement / knowledge_map (a landscaper doesn't want Content Labs
// or competitor reels on their overview). Command Chat leads here too — same intentional
// "on by default in every work space" call as DEFAULT_TEMPLATE. quick_win is included
// (same slot as DEFAULT_TEMPLATE, right after kpi_strip) — an ops-focused tenant still
// gets the 72-hour first-win push; it wasn't a deliberate exclusion, just missed when
// this template was written before quick_win existed.
const OPS_TEMPLATE: DashboardLayout = makeLayout([
  w('agent_chat', 3),
  w('kpi_strip', 3),
  w('quick_win', 3),
  w('north_star', 3),
  w('operator_queue', 1),
  w('todays_priorities', 1),
  w('weekly_snapshot', 1),
  w('hero_agents', 3),
  w('automation_flow', 3),
  w('usage', 3),
]);

/** Named starter layouts. `default` is today's page; the trade templates share the
 *  ops-focused board. Keyed so a template can be looked up by name. */
export const INDUSTRY_TEMPLATES: Record<'default' | IndustryTemplateKey, DashboardLayout> = {
  default: DEFAULT_TEMPLATE,
  landscaping: OPS_TEMPLATE,
  construction: OPS_TEMPLATE,
};

/** Map a freeform business_profile.industry string to a curated template key, or null
 *  when nothing matches (→ caller falls through to DEFAULT_TEMPLATE). Matching is
 *  substring/synonym based since the industry is user-entered free text. */
export function industryTemplateKey(
  industry: string | null | undefined,
): IndustryTemplateKey | null {
  if (!industry || typeof industry !== 'string') return null;
  const s = industry.toLowerCase();
  if (/landscap|lawn\s*care|lawncare|\blawn\b|garden|hardscap|irrigation|nursery|tree\s*service|\byard\b/.test(s)) {
    return 'landscaping';
  }
  if (/construct|contractor|\bbuilder\b|home\s*building|remodel|renovat|roofing|\bhvac\b|plumb|electric|concrete|mason|excavat|paving|carpentr|drywall|framing/.test(s)) {
    return 'construction';
  }
  return null;
}

// ─── Validation ──────────────────────────────────────────────────────────────

function clampSpan(v: unknown): WidgetSpan | undefined {
  return v === 1 || v === 2 || v === 3 ? v : undefined;
}

/**
 * Validate an untrusted layout blob (from the DB or a request body): drop widgets whose
 * id isn't in the registry, de-dupe repeated ids (first wins), and coerce spans to a
 * legal 1|2|3 (a bad/absent span is dropped so the renderer uses the registry default).
 *
 * Returns null ONLY when the input isn't a well-formed layout (not an object, or
 * `widgets` isn't an array). A well-formed layout with zero valid widgets returns an
 * EMPTY layout — a deliberately-empty board is respected, not treated as "unset".
 */
export function sanitizeLayout(raw: unknown): DashboardLayout | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.widgets)) return null;

  const seen = new Set<string>();
  const widgets: LayoutWidget[] = [];
  for (const entry of obj.widgets) {
    if (!entry || typeof entry !== 'object') continue;
    const id = (entry as Record<string, unknown>).id;
    if (typeof id !== 'string' || !WIDGET_ID_SET.has(id) || seen.has(id)) continue;
    seen.add(id);
    const span = clampSpan((entry as Record<string, unknown>).span);
    widgets.push(span ? { id, span } : { id });
  }
  return { version: LAYOUT_VERSION, widgets };
}

/** Build a canonical layout from an untrusted widgets array (always non-null). */
function buildLayout(widgets: unknown): DashboardLayout {
  const clean = sanitizeLayout({ version: LAYOUT_VERSION, widgets: Array.isArray(widgets) ? widgets : [] });
  return clean ?? { version: LAYOUT_VERSION, widgets: [] };
}

// ─── Resolve ─────────────────────────────────────────────────────────────────

/**
 * Resolve the Overview layout for the active (tenant, user). Tenant-scoped: reads
 * tenantId()/currentUserId() from the request context (call enterTenant() first).
 * Precedence: per-user → per-tenant → industry template → DEFAULT_TEMPLATE.
 */
export async function resolveLayout(): Promise<{ layout: DashboardLayout; source: LayoutSource }> {
  const tid = tenantId();
  const uid = currentUserId();

  // 1. Per-user override (this teammate's own board).
  if (uid) {
    const rows = (await sql()`
      SELECT preferences FROM public.workspace_members
      WHERE workspace_id = ${tid} AND user_id = ${uid}
      LIMIT 1
    `) as unknown as Array<{ preferences: Record<string, unknown> | null }>;
    const userLayout = sanitizeLayout(rows[0]?.preferences?.dashboard_layout);
    if (userLayout) return { layout: userLayout, source: 'user' };
  }

  // 2. Per-tenant default + 3. industry template — both come off business_profile.
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tid} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = rows[0]?.business_profile ?? {};

  const tenantLayout = sanitizeLayout(bp.dashboard_layout);
  if (tenantLayout) return { layout: tenantLayout, source: 'tenant' };

  const key = industryTemplateKey(typeof bp.industry === 'string' ? bp.industry : null);
  if (key) return { layout: INDUSTRY_TEMPLATES[key], source: 'industry' };

  // 4. Today's page, exactly.
  return { layout: DEFAULT_TEMPLATE, source: 'default' };
}

// ─── Writers ─────────────────────────────────────────────────────────────────

/**
 * Persist the TENANT default layout onto tenants.business_profile.dashboard_layout
 * WITHOUT clobbering other business_profile keys (top-level jsonb concat, exactly like
 * the onboarding + command_center_views writers). Tenant-scoped. Returns the sanitized
 * layout that was stored. Caller is responsible for the owner-only role gate.
 */
export async function saveTenantLayout(widgets: unknown): Promise<DashboardLayout> {
  const layout = buildLayout(widgets);
  await sql()`
    UPDATE public.tenants
      SET business_profile = COALESCE(business_profile, '{}'::jsonb) || ${jsonb({ dashboard_layout: layout })}
    WHERE id = ${tenantId()}
  `;
  return layout;
}

/**
 * Persist a USER's personal layout onto workspace_members.preferences.dashboard_layout
 * for (activeTenant, userId), merging into the existing prefs jsonb (top-level concat).
 * UPDATE only — a member row is created at invite/seed time; if none exists (e.g. the HQ
 * default tenant), nothing is persisted and { persisted: false } is returned honestly.
 */
export async function saveUserLayout(
  userId: string,
  widgets: unknown,
): Promise<{ layout: DashboardLayout; persisted: boolean }> {
  const layout = buildLayout(widgets);
  const rows = (await sql()`
    UPDATE public.workspace_members
      SET preferences = COALESCE(preferences, '{}'::jsonb) || ${jsonb({ dashboard_layout: layout })}
    WHERE workspace_id = ${tenantId()} AND user_id = ${userId}
    RETURNING preferences
  `) as unknown as Array<{ preferences: Record<string, unknown> | null }>;
  return { layout, persisted: rows.length > 0 };
}
