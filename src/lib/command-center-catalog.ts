// Command Center view CATALOG — the single, PURE source of truth for the toggleable
// client-facing nav views, their grouping, the validation allow-list, and the named
// presets. PURE: no `sql`/server imports, so this module is safe to import from BOTH
// the server lib (command-center-views.ts) AND client components (the Settings panel),
// which is exactly why it lives apart from command-center-views.ts (that file pulls in
// the DB client and must not reach the browser bundle).
//
// SHARED CONTRACT (the enabled-views map): a JSON object keyed by the nav item href
// (e.g. {"/boardroom": false, "/roi": true}). A MISSING key = ENABLED (default all-on),
// so new views and existing clients default on. A view is shown only if map[href] !==
// false. The map is SUBTRACTIVE ONLY: it can hide a view, but the existing HQ-only +
// flag + plan gating still apply on top (a client can never see /issues or /security
// even if the map says true). The HQ workspace IGNORES the map entirely.

/** The enabled-views map: href → enabled? Missing key means enabled (all-on default). */
export type EnabledViews = Record<string, boolean>;

/** The canonical, ordered catalog of toggleable client views, grouped by nav section.
 *  Overview ("/") and Settings are NOT listed — they are always-on so a client can
 *  never lock themselves out. HQ-only /issues + /security are NOT toggleable and NOT
 *  listed. This is the single source for the Settings panel + the defaults. */
export const VIEW_SECTIONS: ReadonlyArray<{
  section: string;
  items: ReadonlyArray<{ href: string; label: string }>;
}> = [
  {
    section: 'Home',
    items: [
      { href: '/tasks', label: 'Tasks' },
      { href: '/drafts', label: 'Approvals' },
      { href: '/goals', label: 'Goals' },
    ],
  },
  {
    section: 'Agents',
    items: [
      { href: '/agents/squads', label: 'Agents' },
      { href: '/agents/skills', label: 'Skills' },
      { href: '/boardroom', label: 'Boardroom' },
    ],
  },
  {
    section: 'Creative',
    items: [{ href: '/content/overview', label: 'Content Lab' }],
  },
  {
    section: 'Marketing',
    items: [
      { href: '/campaigns', label: 'Campaigns' },
      { href: '/missions', label: 'Missions' },
      { href: '/outreach', label: 'Outreach' },
      { href: '/research', label: 'Research' },
    ],
  },
  {
    section: 'Revenue',
    items: [
      { href: '/crm', label: 'CRM' },
      { href: '/roi', label: 'ROI' },
      { href: '/salesops', label: 'SalesOps' },
    ],
  },
  {
    section: 'Insights',
    items: [
      { href: '/analytics', label: 'Analytics' },
      { href: '/kpis', label: 'KPIs' },
      { href: '/usage', label: 'Usage' },
      { href: '/kg', label: 'Knowledge' },
    ],
  },
  {
    section: 'Ops',
    items: [
      { href: '/agents/workspace', label: 'Workspace' },
      { href: '/memory', label: 'Reports' },
      { href: '/learning', label: 'Learning' },
      { href: '/genes', label: 'Genes' },
      { href: '/cron', label: 'Cron' },
      { href: '/activity', label: 'Activity' },
    ],
  },
  {
    section: 'General',
    items: [
      { href: '/connections', label: 'Connections' },
      { href: '/billing', label: 'Billing' },
      { href: '/autonomy', label: 'Autonomy' },
      { href: '/docs', label: 'Docs' },
    ],
  },
] as const;

/** Every toggleable href, flattened from the catalog. The validation allow-list: any
 *  key NOT in this set is dropped (so "/issues", "/security", "/", "/settings" can
 *  never be persisted into the map). */
export const TOGGLEABLE_HREFS: readonly string[] = VIEW_SECTIONS.flatMap((s) =>
  s.items.map((i) => i.href),
);

export const TOGGLEABLE_SET: ReadonlySet<string> = new Set<string>(TOGGLEABLE_HREFS);

/** Build an EnabledViews map that turns OFF every given href (and leaves the rest on
 *  by omission). Helper for the presets below. */
function off(...hrefs: string[]): EnabledViews {
  const m: EnabledViews = {};
  for (const h of hrefs) if (TOGGLEABLE_SET.has(h)) m[h] = false;
  return m;
}

/** Named starter maps the Settings panel / playground can apply in one click. Each
 *  preset is a complete EnabledViews map (missing key = on). `full` = {} = all on. */
export const PRESETS: Record<string, EnabledViews> = {
  full: {},
  lite: off(
    '/agents/skills',
    '/boardroom',
    '/content/overview',
    '/campaigns',
    '/missions',
    '/outreach',
    '/research',
    '/crm',
    '/roi',
    '/salesops',
    '/kpis',
    '/usage',
    '/kg',
    '/agents/workspace',
    '/memory',
    '/learning',
    '/genes',
    '/cron',
    '/activity',
  ),
  content: off('/crm', '/roi', '/salesops', '/genes', '/learning', '/cron'),
  sales: off('/content/overview', '/boardroom', '/missions', '/genes', '/learning', '/cron'),
};

/** Drop keys not in the catalog and coerce every value to a strict boolean. The one
 *  validator both the read and write paths use, so a hand-edited profile (or a crafted
 *  request) can never surface a non-toggleable key like /issues or /security. */
export function sanitizeEnabledViews(input: Record<string, unknown>): EnabledViews {
  const clean: EnabledViews = {};
  for (const [k, v] of Object.entries(input)) {
    if (TOGGLEABLE_SET.has(k)) clean[k] = Boolean(v);
  }
  return clean;
}

/** A view is shown unless explicitly set to false. Missing key = ON. */
export function isViewOn(enabled: EnabledViews, href: string): boolean {
  return enabled[href] !== false;
}
