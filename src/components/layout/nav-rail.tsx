'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type MouseEvent } from 'react';
import {
  Gauge, Bot, Mail, Contact, Zap,
  Search, BarChart3, LineChart, FileText, Rocket, Clock, List, Settings,
  FolderOpen, MessagesSquare, Activity, Target, Inbox, Network, DollarSign, Bug,
  Waves, TrendingUp, Dna, Timer, Link2, Sparkles, ChevronDown, ChevronRight,
  FlaskConical, BookOpen, ArrowUpRight, Boxes, ShieldCheck, PhoneCall, Blocks,
  MessageCircle, UserRound, Heart, Building2,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { NavAgentChatWidget } from '@/components/layout/nav-agent-chat-widget';
import { COMMAND_CENTER_VIEWS_CHANGED_EVENT } from '@/lib/command-center-catalog';

interface NavCounts {
  content: number; outreach: number; signals_today: number; new_leads: number; total_pending: number;
}

type CountKey = keyof NavCounts;

interface NavItem {
  href: string; label: string; icon: typeof Gauge; countKey?: CountKey; newTab?: boolean;
  // When set, the item highlights for any of these path prefixes — used by the
  // Content hub entry, which fronts several routes (/content, /content-lab,
  // /scripts, /competitors, /engagement) that no longer have their own rail row.
  matchPrefixes?: string[];
  // When set, the item is hidden unless the named feature flag (from /api/auth/me)
  // is true. Used by flag-gated surfaces (e.g. SalesOps) so nothing renders until
  // the operator flips SALESOPS_ENABLED — the routes enforce the flag server-side too.
  flag?: 'salesops_enabled' | 'playground_enabled';
}
interface NavGroup {
  label: string; items: NavItem[]; collapsible?: boolean;
  // Starts closed on a fresh browser (MORE). An explicit stored preference wins.
  defaultCollapsed?: boolean;
}

// The nav is grouped by the SIX North Star sections (see the KeyPlayers North Star,
// §12 "The Executive Assistant Command Centre") — Founder Profile / Daily Operations /
// Personal Life / Company Knowledge / Relationships / Your AI Team. The job of this
// order is to read like an executive-support product to an assistant on day one, not
// like a marketing console.
//
// IMPORTANT — hrefs are the stable contract. The per-tenant enabled-views map
// (command-center-catalog.ts) is keyed by href, so regrouping and relabelling is safe
// but CHANGING an href silently un-hides a view a client had switched off. Move rows
// between sections freely; don't rewrite their hrefs.
//
// Anything that doesn't belong to the six lives in MORE (collapsed by default) so no
// surface is lost — it's one click away rather than competing for attention.
const PRIMARY: NavGroup[] = [
  {
    label: 'FOUNDER PROFILE',
    items: [
      { href: '/', label: 'Overview', icon: Gauge },
      { href: '/founder', label: 'Founder Profile', icon: UserRound },
    ],
  },
  {
    label: 'DAILY OPERATIONS',
    items: [
      { href: '/tasks', label: 'Tasks', icon: Activity },
      { href: '/drafts', label: 'Approvals', icon: Inbox, countKey: 'total_pending' },
      { href: '/goals', label: 'Goals', icon: Target },
      { href: '/cron', label: 'Schedules', icon: Clock },
      { href: '/activity', label: 'Activity Log', icon: List },
    ],
  },
  // Company Knowledge sits ABOVE Personal Life — a deliberate swap against the North
  // Star §12 ordering. The Second Brain is the highest-traffic surface in the product
  // and a one-row section ahead of it pushed it below the fold on a 13" laptop. Personal
  // Life loses nothing by sitting one row lower; the Second Brain loses a lot by being
  // invisible without scrolling.
  {
    label: 'COMPANY KNOWLEDGE',
    items: [
      { href: '/kg', label: 'Second Brain', icon: Network },
      { href: '/memory', label: 'Briefings', icon: FileText },
      { href: '/agents/workspace', label: 'Files', icon: FolderOpen },
      { href: '/learning', label: 'Learning', icon: TrendingUp },
      // Points at the in-app guide, NOT /docs: the docs site opens in a new tab, and
      // sending someone out of the app to learn the app is the reason nobody read them.
      // The guide links on to /docs for depth.
      { href: '/how-it-works', label: 'How to use this', icon: BookOpen },
    ],
  },
  {
    label: 'PERSONAL LIFE',
    items: [
      { href: '/personal', label: 'Personal Life', icon: Heart },
    ],
  },
  {
    label: 'RELATIONSHIPS',
    items: [
      { href: '/crm', label: 'Contacts', icon: Contact, countKey: 'new_leads' },
      { href: '/outreach', label: 'Outreach', icon: Mail, countKey: 'outreach' },
    ],
  },
  {
    label: 'YOUR AI TEAM',
    items: [
      { href: '/boardroom', label: 'Ask the Team', icon: MessagesSquare, matchPrefixes: ['/boardroom'] },
      { href: '/agents/squads', label: 'Agents', icon: Bot, matchPrefixes: ['/agents/squads'] },
      { href: '/org-chart', label: 'Org Chart', icon: Network },
      { href: '/agents/skills', label: 'Skills', icon: Boxes, matchPrefixes: ['/agents/skills'] },
      { href: '/agents/comms', label: 'Messages', icon: MessageCircle, matchPrefixes: ['/agents/comms'] },
      { href: '/missions', label: 'Missions', icon: Rocket },
      { href: '/autonomy', label: 'Autonomy', icon: Zap },
    ],
  },
];

// MORE — everything outside the six sections. Collapsed by default so it stays out of
// the way, but every surface remains reachable (nothing was deleted). Replaces the old
// OPS + INSIGHTS + the marketing/revenue rows.
const MORE: NavGroup = {
  label: 'MORE',
  collapsible: true,
  defaultCollapsed: true,
  items: [
    // Content Lab fronts Ideas / Scripts / Hyperframes / Media / Competitors /
    // Pipeline / Library / Engagement as tabs (see content-tabs.tsx).
    { href: '/content/overview', label: 'Content Lab', icon: FlaskConical, countKey: 'content',
      matchPrefixes: ['/content', '/content-lab', '/scripts', '/competitors', '/engagement'] },
    { href: '/campaigns', label: 'Campaigns', icon: Waves },
    { href: '/research', label: 'Research', icon: Search, countKey: 'signals_today' },
    { href: '/roi', label: 'ROI', icon: Timer },
    { href: '/salesops', label: 'SalesOps', icon: PhoneCall, flag: 'salesops_enabled' },
    { href: '/analytics', label: 'Analytics', icon: LineChart },
    { href: '/kpis', label: 'KPIs', icon: BarChart3 },
    { href: '/usage', label: 'Usage', icon: DollarSign },
    { href: '/genes', label: 'Genes', icon: Dna },
    // Command Center Builder — OPTIONAL onboarding surface, hidden unless
    // PLAYGROUND_ENABLED is on (surfaced as playground_enabled from /api/auth/me). The
    // /playground page double-checks the flag server-perceived from /api/auth/me too.
    { href: '/playground', label: 'Playground', icon: Blocks, flag: 'playground_enabled' },
    { href: '/issues', label: 'Issues', icon: Bug },
    { href: '/security', label: 'Security', icon: ShieldCheck },
  ],
};

// BOTTOM — collapsible "SETUP" dropdown (Connections / Billing) plus a standalone
// pinned Settings row (always visible, never in a dropdown so a client can never
// collapse their way out of reach of Settings).
//
// Closed by default: Connections and Billing are set-up-once surfaces, and the pinned
// footer was costing ~250px of a 672px rail — enough to push Company Knowledge (the
// Second Brain) below the fold on a laptop. Collapsing it hands that height back to
// the six sections. Settings stays pinned and visible regardless.
const BOTTOM_GROUP: NavGroup = {
  label: 'SETUP',
  collapsible: true,
  defaultCollapsed: true,
  items: [
    { href: '/business-setup', label: 'Business Setup', icon: Building2 },
    { href: '/connections', label: 'Connections', icon: Link2 },
    { href: '/billing', label: 'Billing', icon: Sparkles },
  ],
};

const SETTINGS_ITEM: NavItem = { href: '/settings', label: 'Settings', icon: Settings };

// Per-section accent (matches the Overview lens / agent-orb department colors). Keyed
// by the section LABEL (as rendered). Drives both the colored header dot/label tint and
// the accentVar handed to the floating chat widget. Unmapped labels fall back to
// var(--muted-foreground) for the header and var(--primary) for the widget accent.
const SECTION_COLOR_MAP: Record<string, string> = {
  'FOUNDER PROFILE': 'var(--primary)',
  'DAILY OPERATIONS': 'var(--dept-leadership)',
  'PERSONAL LIFE': 'var(--dept-client-experience)',
  'COMPANY KNOWLEDGE': 'var(--dept-operations)',
  RELATIONSHIPS: 'var(--dept-revenue)',
  'YOUR AI TEAM': 'var(--dept-marketing)',
  MORE: 'var(--muted-foreground)',
  SETUP: 'var(--primary)',
};

// Sections that get the inline agent-chat widget. Each label must also be handled by
// sectionFilterFor() in nav-agent-chat-widget.tsx, which decides WHICH agents that
// section's chat talks to — an unrecognised label silently falls back to executives
// only, so keep the two lists in step. FOUNDER PROFILE, PERSONAL LIFE and SETUP stay
// excluded (no agents behind them): no chat there.
const CHAT_SECTIONS: ReadonlySet<string> = new Set([
  'DAILY OPERATIONS', 'COMPANY KNOWLEDGE', 'RELATIONSHIPS', 'YOUR AI TEAM', 'MORE',
]);

// Per-user persisted open/closed state for a section. Most sections default OPEN; a
// group marked defaultCollapsed (MORE) starts closed until the user opens it. Either
// way an explicit stored value always wins, so a preference survives reloads. Keyed by
// the section label so it never collides with other UI state.
const collapseKey = (section: string) => `nav:collapsed:${section}`;

function readCollapsed(section: string, fallback = false): boolean {
  if (typeof window === 'undefined') return fallback;
  try {
    const stored = window.localStorage.getItem(collapseKey(section));
    if (stored === 'closed') return true;
    if (stored === 'open') return false;
    return fallback;
  } catch {
    return fallback;
  }
}

function writeCollapsed(section: string, collapsed: boolean) {
  try {
    window.localStorage.setItem(collapseKey(section), collapsed ? 'closed' : 'open');
  } catch {
    /* private mode / storage disabled — fall back to in-memory state only */
  }
}

export function NavRail() {
  const pathname = usePathname();
  const realOnly = useDashboard(s => s.realOnly);
  // KeyWatch / Issues and the Security Console are HQ-only (both read across tenants
  // and can act on the platform). Hide them from client workspaces — the APIs enforce
  // it server-side too. Default false so they're hidden until proven HQ.
  const HQ_ONLY = new Set(['/issues', '/security']);
  const [isHq, setIsHq] = useState(false);
  // Feature flags that hide/show nav items. Keyed by the NavItem.flag value. Default
  // all-off so a flag-gated item (SalesOps) stays hidden until /api/auth/me reports it
  // enabled — the routes enforce the flag server-side regardless.
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  // The per-tenant enabled-views map (keyed by nav href). SUBTRACTIVE ONLY: a view is
  // hidden when its key is explicitly false; a MISSING key reads as enabled (default
  // all-on). The HQ workspace IGNORES this map entirely — operators always see every
  // view (the filter below is gated on !isHq). Defaults to {} so before /api/auth/me
  // resolves nothing is hidden.
  const [views, setViews] = useState<Record<string, boolean>>({});
  // Which section's floating agent chat is open. Only one at a time (a section label
  // or null). Lifted here so toggling one section's chat closes any other.
  const [openChatSection, setOpenChatSection] = useState<string | null>(null);
  useEffect(() => {
    const loadMe = () => {
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((j) => {
        setIsHq(!!j?.is_hq);
        setFlags({
          salesops_enabled: !!j?.salesops_enabled,
          playground_enabled: !!j?.playground_enabled,
        });
        setViews((j?.command_center_views && typeof j.command_center_views === 'object')
          ? (j.command_center_views as Record<string, boolean>)
          : {});
      }).catch(() => {});
    };
    loadMe();
    // NavRail lives at the app-root layout and never remounts on client-side
    // navigation, so a toggle/preset saved from Settings (or the Playground) would
    // otherwise persist to the DB but stay invisible here until a hard reload.
    // Re-fetch on this event (dispatched after every successful views write) so the
    // rail updates immediately.
    window.addEventListener(COMMAND_CENTER_VIEWS_CHANGED_EVENT, loadMe);
    return () => window.removeEventListener(COMMAND_CENTER_VIEWS_CHANGED_EVENT, loadMe);
  }, []);

  // A view passes the enabled-views map when EITHER we're the HQ workspace (operators
  // see everything) OR the map doesn't explicitly disable it. Overview "/" is always on
  // (callers also pass it through unconditionally) so a client can't lock themselves out.
  const viewEnabled = (href: string) => isHq || href === '/' || views[href] !== false;

  const { data: counts } = useSmartPoll<NavCounts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  return (
    <nav className="nav-rail fixed left-0 top-[var(--header-height)] bottom-0 w-[var(--nav-width)] surface-opaque border-r border-border z-40 hidden md:flex flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {PRIMARY.map((group, idx) => (
          <CollapsibleSection
            key={group.label}
            group={group}
            counts={counts ?? null}
            pathname={pathname}
            flags={flags}
            hqOnly={HQ_ONLY}
            isHq={isHq}
            viewEnabled={viewEnabled}
            openChatSection={openChatSection}
            setOpenChatSection={setOpenChatSection}
            className={idx > 0 ? 'mt-2 pt-2 border-t border-border/40' : ''}
          />
        ))}

        {/* MORE — everything outside the six sections, collapsed by default. */}
        <CollapsibleSection
          group={MORE}
          counts={counts ?? null}
          pathname={pathname}
          flags={flags}
          hqOnly={HQ_ONLY}
          isHq={isHq}
          viewEnabled={viewEnabled}
          openChatSection={openChatSection}
          setOpenChatSection={setOpenChatSection}
          className="mt-2 pt-2 border-t border-border/40"
        />
      </div>

      {/* BOTTOM — collapsible SETUP dropdown (Connections / Billing) + a standalone
          pinned Settings row that's ALWAYS visible. */}
      <div className="border-t border-border/60 px-2 py-2">
        <CollapsibleSection
          group={BOTTOM_GROUP}
          counts={counts ?? null}
          pathname={pathname}
          flags={flags}
          hqOnly={HQ_ONLY}
          isHq={isHq}
          viewEnabled={viewEnabled}
          openChatSection={openChatSection}
          setOpenChatSection={setOpenChatSection}
          compact
        />
        <div className="mt-0.5">
          <NavLink item={SETTINGS_ITEM} active={pathname.startsWith(SETTINGS_ITEM.href)} count={0} compact />
        </div>
      </div>

      <UserCard />
    </nav>
  );
}

// One collapsible section: a click-to-expand header (chevron rotates on open) over its
// nav items, reusing the mechanism OPS originally used. Open/closed state persists
// per-user in localStorage (default OPEN) and the section auto-opens when the active
// route lives inside it. Visibility filters stack: an item shows only when it passes the
// HQ-only rule AND its feature flag AND the enabled-views map (the map is bypassed for
// HQ via viewEnabled). A section with zero visible items renders nothing (no orphan
// header).
function CollapsibleSection({
  group, counts, pathname, className, flags, hqOnly, isHq, viewEnabled, compact,
  openChatSection, setOpenChatSection,
}: {
  group: NavGroup;
  counts: NavCounts | null;
  pathname: string;
  className?: string;
  flags?: Record<string, boolean>;
  hqOnly: Set<string>;
  isHq: boolean;
  viewEnabled: (href: string) => boolean;
  compact?: boolean;
  openChatSection: string | null;
  setOpenChatSection: (label: string | null) => void;
}) {
  const items = group.items.filter((i) =>
    // HQ-only items hide outside HQ; flag-gated items hide until their flag is on;
    // everything else passes the subtractive enabled-views map.
    (!hqOnly.has(i.href) || isHq) &&
    (!i.flag || flags?.[i.flag]) &&
    viewEnabled(i.href),
  );
  // Hydration-safe: render the group's default on the server / first client paint,
  // then reconcile with the persisted preference after mount so SSR markup matches and
  // we never read localStorage during render.
  const [open, setOpen] = useState(!group.defaultCollapsed);
  useEffect(() => {
    setOpen(!readCollapsed(group.label, !!group.defaultCollapsed));
  }, [group.label, group.defaultCollapsed]);

  // Auto-open when you navigate into one of this section's (visible) items, so the
  // active route is never hidden behind a collapsed header.
  const hasActive = items.some((i) => isItemActive(i, pathname));
  useEffect(() => {
    if (hasActive) setOpen(true);
  }, [hasActive]);

  // An empty section (every item filtered out) renders no header at all.
  if (items.length === 0) return null;

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      writeCollapsed(group.label, !next);
      return next;
    });
  };

  // Section accent: drives the header dot + label/chevron tint AND the chat widget.
  const accent = SECTION_COLOR_MAP[group.label];
  const headerColor = accent ?? 'var(--muted-foreground)';
  const hasChat = CHAT_SECTIONS.has(group.label);
  const chatOpen = hasChat && openChatSection === group.label;
  const toggleChat = (e: MouseEvent) => {
    // Never let the chat button collapse/expand the section dropdown.
    e.stopPropagation();
    setOpenChatSection(chatOpen ? null : group.label);
  };

  return (
    <div className={className}>
      <div className="w-full flex items-center gap-1 px-2 pb-1">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex flex-1 items-center gap-1.5 text-[10px] uppercase tracking-wider font-semibold min-w-0"
          style={{
            color: headerColor,
            opacity: 0.85,
            transition: 'color var(--t-press) var(--ease-out), opacity var(--t-press) var(--ease-out)',
          }}
        >
          {/* Section accent dot */}
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ background: headerColor }}
          />
          <span className="truncate">{group.label}</span>
          <ChevronRight
            size={11}
            style={{
              transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
              transition: 'transform var(--t-press) var(--ease-out)',
            }}
          />
        </button>
        {/* Per-section agent chat toggle — only on sections that map to real agents
            (beside the chevron, never toggles collapse). */}
        {hasChat && (
          <button
            type="button"
            onClick={toggleChat}
            aria-label={`Chat with ${group.label} agents`}
            aria-pressed={chatOpen}
            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md active:scale-95"
            style={{
              color: chatOpen ? headerColor : 'var(--muted-foreground)',
              background: chatOpen ? `color-mix(in srgb, ${headerColor} 16%, transparent)` : 'transparent',
              transition: 'color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
            }}
          >
            <MessageCircle size={12} />
          </button>
        )}
      </div>
      {hasChat && (
        <NavAgentChatWidget
          sectionLabel={group.label}
          accentVar={accent ?? 'var(--primary)'}
          open={chatOpen}
          onClose={() => setOpenChatSection(null)}
        />
      )}
      {open && (
        <div className={`${compact ? 'space-y-0.5' : 'space-y-0.5 mt-1'}`} data-stagger>
          {items.map((item) => {
            const active = isItemActive(item, pathname);
            const count = item.countKey && counts ? counts[item.countKey] : 0;
            return <NavLink key={item.href} item={item} active={active} count={count} compact={compact} />;
          })}
        </div>
      )}
    </div>
  );
}

// A nav item is active when the path matches its href (exact for "/", prefix
// otherwise) or any of its declared matchPrefixes. The "+ '/'" guard stops
// /content from claiming /content-lab — only true sub-paths count.
function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.matchPrefixes) {
    return item.matchPrefixes.some((p) => pathname === p || pathname.startsWith(p + '/'));
  }
  return item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
}

function NavLink({ item, active, count, compact }:
  { item: NavItem; active: boolean; count: number; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      target={item.newTab ? '_blank' : undefined}
      rel={item.newTab ? 'noreferrer' : undefined}
      data-walkthrough={`nav:${item.href}`}
      className={`relative w-full flex items-center gap-2 px-2 ${compact ? 'py-1' : 'py-1.5'} rounded-lg text-sm`}
      style={{
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        background: active ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
        transition: 'color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out)',
      }}
    >
      {active && <span className="absolute left-0 w-0.5 h-5 bg-primary rounded-r" />}
      <Icon size={15} />
      <span className="flex-1 truncate">{item.label}</span>
      {item.newTab && <ArrowUpRight size={12} className="opacity-50" />}
      {count > 0 && (
        <span className={`min-w-[18px] h-4 px-1 text-[9px] font-bold rounded-full flex items-center justify-center ${
          item.countKey === 'signals_today' ? 'count-badge-info' : 'count-badge'
        }`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}

// ─── User profile card at bottom — matches the reference image ────────────────
interface UserMe { user?: { id?: string; email?: string; role?: string } }
interface EntPayload { plan?: string; catalog?: Record<string, { label: string }> }

type AlertSeverity = 'critical' | 'warning' | 'info';
interface HealthAlert { id: string; severity: AlertSeverity; title: string; detail?: string; href?: string }
interface HealthPayload {
  score: number;
  status: 'healthy' | 'degraded' | 'down';
  alerts: HealthAlert[];
  trend: number[];
  activity24h: number;
}

const SEV_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
function sevColor(s: AlertSeverity): string {
  return s === 'critical' ? 'var(--destructive)' : s === 'warning' ? 'var(--warning, #f59e0b)' : 'var(--info, var(--primary))';
}
function scoreColor(score: number | null): string {
  if (score == null) return 'var(--muted-foreground)';
  return score >= 90 ? 'var(--success)' : score >= 60 ? 'var(--warning, #f59e0b)' : 'var(--destructive)';
}

function UserCard() {
  const [me, setMe] = useState<UserMe | null>(null);
  const [ent, setEnt] = useState<EntPayload | null>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    let cancel = false;
    Promise.all([
      fetch('/api/auth/me').then((r) => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/entitlements').then((r) => r.ok ? r.json() : null).catch(() => null),
    ]).then(([m, e]: [UserMe | null, EntPayload | null]) => {
      if (cancel) return;
      setMe(m); setEnt(e);
    });
    return () => { cancel = true; };
  }, []);

  // Real, live system health — polled every 30s. See /api/health.
  const { data: health } = useSmartPoll<HealthPayload>(
    () => fetch('/api/health').then((r) => r.json()),
    { interval: 30_000 },
  );

  const email = me?.user?.email ?? '—';
  const initial = (email?.[0] ?? 'U').toUpperCase();
  const planLabel = ent?.plan && ent.catalog?.[ent.plan]?.label ? ent.catalog[ent.plan].label : '—';

  const score = health?.score ?? null;
  const alerts = health?.alerts ?? [];
  const trend = health?.trend ?? [];
  const color = scoreColor(score);
  // Worst severity present drives the alert-row dot.
  const topSeverity = alerts.reduce<AlertSeverity | null>(
    (worst, a) => (worst == null || SEV_RANK[a.severity] < SEV_RANK[worst] ? a.severity : worst), null);
  const idle = health != null && health.activity24h === 0 && alerts.length === 0;

  return (
    <div className="m-2 mt-1 rounded-xl border border-border/60 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-2.5 space-y-2">
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold shrink-0"
          style={{ background: 'radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--primary) 60%, white), var(--primary) 70%)', color: 'var(--primary-foreground)' }}>
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-medium truncate leading-tight">{email}</div>
          <div className="text-[9px] text-muted-foreground uppercase tracking-wider">{planLabel}</div>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>System Health</span>
          <span className="font-mono font-semibold" style={{ color }}>
            {score == null ? '—' : `${score}%`}{idle && <span className="ml-1 text-muted-foreground font-normal">idle</span>}
          </span>
        </div>
        <Sparkline values={trend} color={color} />
      </div>

      {/* Alerts — collapsed by default; the dot + count is always visible so a
          problem is glanceable without opening it. */}
      <div className="pt-1.5 border-t border-border/40">
        <button
          type="button"
          onClick={() => alerts.length && setAlertsOpen((v) => !v)}
          className="w-full flex items-center gap-1.5 text-[10px]"
          style={{ cursor: alerts.length ? 'pointer' : 'default' }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: topSeverity ? sevColor(topSeverity) : 'var(--success)' }}
          />
          <span className="flex-1 text-left text-muted-foreground">
            {alerts.length ? `${alerts.length} alert${alerts.length > 1 ? 's' : ''}` : 'All systems normal'}
          </span>
          {alerts.length > 0 && (alertsOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />)}
        </button>

        {alertsOpen && alerts.length > 0 && (
          <div className="mt-1 space-y-1 max-h-44 overflow-y-auto" data-stagger>
            {alerts.map((a) => (
              <Link
                key={a.id}
                href={a.href ?? '#'}
                className="block rounded-md px-1.5 py-1"
                style={{ background: 'color-mix(in srgb, var(--surface-2) 60%, transparent)' }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sevColor(a.severity) }} />
                  <span className="text-[10px] font-medium truncate flex-1">{a.title}</span>
                </div>
                {a.detail && <p className="text-[9px] text-muted-foreground mt-0.5 pl-3 line-clamp-2">{a.detail}</p>}
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Sparkline({ values, color = 'var(--primary)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const w = 180, h = 28;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(max - min, 1);
  const dx = w / (values.length - 1);
  const points = values.map((v, i) => `${(i * dx).toFixed(1)},${(h - ((v - min) / range) * (h - 4) - 2).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} aria-hidden style={{ display: 'block' }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polyline points={`0,${h} ${points} ${w},${h}`} fill="url(#spark-fill)" stroke="none" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
