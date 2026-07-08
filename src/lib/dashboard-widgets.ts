// Dashboard widget CATALOG — the single, PURE source of truth for the Overview board's
// widgets (the "Lobsterboard"). PURE: no `sql`/server imports and no React/component
// imports, so this module is safe to import from BOTH the server lib
// (dashboard-layout.ts, the layout API route) AND client components (the board renderer
// + the "add widget" menu). This is deliberately the same split proven by
// command-center-catalog.ts, so the board and the layout resolver share ONE registry
// with zero drift.
//
// One entry per EXISTING overview component (src/components/dashboard/* unless noted).
// The persisted layout stores only widget `id`s (+ an optional span) — never component
// references — so the saved jsonb blob stays forward-compatible. `component` is a stable
// STRING key; the CLIENT-side lazy-import map (owned by the board renderer) binds each
// key to its actual React component. No component is referenced here.

/** Category buckets used to group widgets in the "add widget" menu. */
export type WidgetCategory = 'ops' | 'growth' | 'content' | 'insights';

/** How many columns of the 3-column board grid a widget occupies (grid-column: span N). */
export type WidgetSpan = 1 | 2 | 3;

export interface WidgetDef {
  /** Stable slug — the persistence key. Never renamed once shipped. */
  id: string;
  /** Menu label. */
  title: string;
  /** One-line description for the "add widget" menu. */
  description: string;
  /** Menu grouping. */
  category: WidgetCategory;
  /** Span used when a layout entry omits an explicit span. */
  defaultSpan: WidgetSpan;
  /** Stable key the client-side component map binds to a lazy-loaded React component. */
  component: string;
}

/** The canonical registry: one entry per overview component. Order here is the menu
 *  order, NOT the board order (board order comes from the resolved layout). */
export const DASHBOARD_WIDGETS: readonly WidgetDef[] = [
  {
    id: 'kpi_strip',
    title: 'System Status',
    description: 'Five-cell KPI strip: the health of the whole operation at a glance.',
    category: 'ops',
    defaultSpan: 3,
    component: 'KpiStrip',
  },
  {
    id: 'quick_win',
    title: 'Quick Win Countdown',
    description: '72-hour activation card. Auto-hides once the first win lands.',
    category: 'ops',
    defaultSpan: 3,
    component: 'QuickWinCountdown',
  },
  {
    id: 'north_star',
    title: 'North Star & Priorities',
    description: 'The one North Star metric plus the three top priorities driving it.',
    category: 'growth',
    defaultSpan: 3,
    component: 'NorthStarSlot',
  },
  {
    id: 'hero_agents',
    title: 'Hero Agents',
    description: 'The active department lens’s agent cards, live heartbeat and all.',
    category: 'ops',
    defaultSpan: 3,
    component: 'HeroAgents',
  },
  {
    id: 'operator_queue',
    title: 'Operator Queue',
    description: 'The owner action queue: what needs a human decision right now.',
    category: 'ops',
    defaultSpan: 1,
    component: 'OperatorQueue',
  },
  {
    id: 'todays_priorities',
    title: "Today's Priorities",
    description: 'The action items surfaced for the active lens today.',
    category: 'ops',
    defaultSpan: 1,
    component: 'TodaysPriorities',
  },
  {
    id: 'weekly_snapshot',
    title: 'Weekly Snapshot',
    description: 'This week’s headline metrics vs. last week.',
    category: 'insights',
    defaultSpan: 1,
    component: 'WeeklySnapshot',
  },
  {
    id: 'competitor_intel',
    title: 'Competitor Intel',
    description: 'What competitors are shipping and where they’re moving.',
    category: 'content',
    defaultSpan: 1,
    component: 'CompetitorOverviewCard',
  },
  {
    id: 'content_lab',
    title: 'Content Lab',
    description: 'The content pipeline: what’s drafted, queued, and ready to ship.',
    category: 'content',
    defaultSpan: 1,
    component: 'ContentLabOverviewCard',
  },
  {
    id: 'engagement',
    title: 'Engagement',
    description: 'Inbound engagement: who’s reaching back and needs a reply.',
    category: 'content',
    defaultSpan: 1,
    component: 'EngagementOverviewCard',
  },
  {
    id: 'automation_flow',
    title: 'Automation Flow',
    description: 'The active PARL campaign’s waves, flowing left to right.',
    category: 'ops',
    defaultSpan: 3,
    component: 'AutomationFlow',
  },
  {
    id: 'usage',
    title: 'Claude Usage',
    description: 'Claude API spend and token usage for the workspace.',
    category: 'insights',
    defaultSpan: 3,
    component: 'UsageWidget',
  },
  {
    id: 'knowledge_map',
    title: 'Knowledge Map',
    description: 'A compact graph of the entities and relations agents have learned.',
    category: 'insights',
    defaultSpan: 3,
    component: 'KnowledgeMiniMap',
  },
  {
    id: 'department_roster',
    title: 'Department Roster',
    description: 'The full team roster grouped by department.',
    category: 'ops',
    defaultSpan: 1,
    component: 'DepartmentRoster',
  },
];

/** Every valid widget id, in registry order. */
export const DASHBOARD_WIDGET_IDS: readonly string[] = DASHBOARD_WIDGETS.map((w) => w.id);

/** Fast membership check used by the layout validator (drop unknown ids). */
export const WIDGET_ID_SET: ReadonlySet<string> = new Set<string>(DASHBOARD_WIDGET_IDS);

const WIDGET_BY_ID: ReadonlyMap<string, WidgetDef> = new Map(
  DASHBOARD_WIDGETS.map((w) => [w.id, w]),
);

/** Look up a widget def by id, or undefined if the id isn't in the registry. */
export function widgetById(id: string): WidgetDef | undefined {
  return WIDGET_BY_ID.get(id);
}

/** The registered defaultSpan for an id, or 1 for an unknown id (defensive). */
export function defaultSpanFor(id: string): WidgetSpan {
  return WIDGET_BY_ID.get(id)?.defaultSpan ?? 1;
}
