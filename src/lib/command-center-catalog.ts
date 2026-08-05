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
    section: 'Founder Profile',
    items: [
      { href: '/founder', label: 'Founder Profile' },
    ],
  },
  {
    section: 'Daily Operations',
    items: [
      { href: '/tasks', label: 'Tasks' },
      { href: '/drafts', label: 'Approvals' },
      { href: '/goals', label: 'Goals' },
      { href: '/cron', label: 'Schedules' },
      { href: '/activity', label: 'Activity Log' },
    ],
  },
  {
    section: 'Company Knowledge',
    items: [
      { href: '/kg', label: 'Second Brain' },
      { href: '/memory', label: 'Briefings' },
      { href: '/agents/workspace', label: 'Files' },
      { href: '/learning', label: 'Learning' },
      { href: '/how-it-works', label: 'How to use this' },
    ],
  },
  {
    section: 'Personal Life',
    items: [
      { href: '/personal', label: 'Personal Life' },
    ],
  },
  {
    section: 'Relationships',
    items: [
      { href: '/crm', label: 'Contacts' },
      { href: '/outreach', label: 'Outreach' },
    ],
  },
  {
    section: 'Your AI Team',
    items: [
      { href: '/boardroom', label: 'Ask the Team' },
      { href: '/agents/squads', label: 'Agents' },
      { href: '/org-chart', label: 'Org Chart' },
      { href: '/agents/skills', label: 'Skills' },
      { href: '/agents/comms', label: 'Messages' },
      { href: '/missions', label: 'Missions' },
      { href: '/autonomy', label: 'Autonomy' },
    ],
  },
  {
    section: 'Your KeyPlayers',
    items: [
      { href: '/portal', label: 'Your KeyPlayers' },
    ],
  },
  {
    section: 'More',
    items: [
      { href: '/content/overview', label: 'Content Lab' },
      { href: '/campaigns', label: 'Campaigns' },
      { href: '/research', label: 'Research' },
      { href: '/roi', label: 'ROI' },
      { href: '/salesops', label: 'SalesOps' },
      { href: '/analytics', label: 'Analytics' },
      { href: '/kpis', label: 'KPIs' },
      { href: '/usage', label: 'Usage' },
      { href: '/genes', label: 'Genes' },
    ],
  },
  {
    section: 'Setup',
    items: [
      { href: '/business-setup', label: 'Business Setup' },
      { href: '/connections', label: 'Connections' },
      { href: '/billing', label: 'Billing' },
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
  // REWRITTEN for the six-section nav. The old `lite` switched off /kg (the Second
  // Brain), /memory (Briefings), /crm (Contacts) and /boardroom (Ask the Team) — all
  // of which are now headline sections, so a "lite" client lost the core of the
  // product and kept the marketing machinery. Inverted: lite keeps everything an
  // assistant works out of daily and drops the growth/analytics tooling.
  lite: off(
    '/content/overview',
    '/campaigns',
    '/missions',
    '/research',
    '/roi',
    '/salesops',
    '/analytics',
    '/kpis',
    '/usage',
    '/genes',
    '/learning',
    '/activity',
    '/agents/skills',
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

// ─── Cross-component change notification ───────────────────────────────────────
// NavRail (src/components/layout/nav-rail.tsx) fetches the enabled-views map from
// /api/auth/me exactly ONCE, on mount — it's rendered at the app root layout, so it
// never remounts on client-side navigation. Without a bridge, saving a toggle/preset
// from Settings (or the Playground) persists to the DB but the visible nav stays
// stale until a hard reload. The Settings panel + Playground call
// notifyCommandCenterViewsChanged() after every successful write; NavRail listens
// for it and re-fetches /api/auth/me to pick up the new map immediately.
export const COMMAND_CENTER_VIEWS_CHANGED_EVENT = 'cc-views-changed';

export function notifyCommandCenterViewsChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(COMMAND_CENTER_VIEWS_CHANGED_EVENT));
}
