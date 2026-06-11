'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  Gauge, Bot, Mail, Contact, Zap,
  Search, BarChart3, LineChart, FileText, Rocket, Clock, List, Settings,
  FolderOpen, MessagesSquare, Activity, Target, Inbox, Network, DollarSign, Bug,
  Waves, TrendingUp, Dna, Timer, Link2, Sparkles, ChevronDown, ChevronRight,
  FlaskConical, BookOpen, ArrowUpRight,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';

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
}
interface NavGroup { label: string; items: NavItem[]; collapsible?: boolean }

// The nav is grouped by business DIVISION (not engineering intent): HOME for the
// universal daily items, then Creative / Marketing / Revenue / Insights / Agents.
// OPS is "things I check when something's broken" and starts collapsed. BOTTOM
// stays pinned for setup/billing regardless of scroll.
const PRIMARY: NavGroup[] = [
  {
    label: 'HOME',
    items: [
      { href: '/', label: 'Overview', icon: Gauge },
      { href: '/tasks', label: 'Tasks', icon: Activity },
      { href: '/drafts', label: 'Approvals', icon: Inbox, countKey: 'total_pending' },
      { href: '/goals', label: 'Goals', icon: Target },
    ],
  },
  {
    label: 'CREATIVE',
    items: [
      // The Content hub fronts Ideas / Scripts / Hyperframes / Media / Competitors
      // / Pipeline / Library / Engagement as tabs (see content-tabs.tsx).
      { href: '/content/overview', label: 'Content', icon: FlaskConical, countKey: 'content',
        matchPrefixes: ['/content', '/content-lab', '/scripts', '/competitors', '/engagement'] },
    ],
  },
  {
    label: 'MARKETING',
    items: [
      { href: '/campaigns', label: 'Campaigns', icon: Waves },
      { href: '/missions', label: 'Missions', icon: Rocket },
      { href: '/outreach', label: 'Outreach', icon: Mail, countKey: 'outreach' },
      { href: '/research', label: 'Research', icon: Search, countKey: 'signals_today' },
    ],
  },
  {
    label: 'REVENUE',
    items: [
      { href: '/crm', label: 'CRM', icon: Contact, countKey: 'new_leads' },
      { href: '/roi', label: 'ROI', icon: Timer },
    ],
  },
  {
    label: 'INSIGHTS',
    items: [
      { href: '/analytics', label: 'Analytics', icon: LineChart },
      { href: '/kpis', label: 'KPIs', icon: BarChart3 },
      { href: '/usage', label: 'Usage', icon: DollarSign },
      { href: '/kg', label: 'Knowledge', icon: Network },
    ],
  },
  {
    label: 'AGENTS',
    items: [
      { href: '/agents/squads', label: 'Agents', icon: Bot, matchPrefixes: ['/agents/squads'] },
      { href: '/boardroom', label: 'Boardroom', icon: MessagesSquare, matchPrefixes: ['/boardroom'] },
      { href: '/automations', label: 'Automations', icon: Zap },
    ],
  },
];

const OPS: NavGroup = {
  label: 'OPS',
  collapsible: true,
  items: [
    { href: '/agents/workspace', label: 'Workspace', icon: FolderOpen },
    { href: '/memory', label: 'Reports', icon: FileText },
    { href: '/learning', label: 'Learning', icon: TrendingUp },
    { href: '/genes', label: 'Genes', icon: Dna },
    { href: '/issues', label: 'Issues', icon: Bug },
    { href: '/cron', label: 'Cron', icon: Clock },
    { href: '/activity', label: 'Activity', icon: List },
  ],
};

const BOTTOM: NavItem[] = [
  { href: '/connections', label: 'Connections', icon: Link2 },
  { href: '/billing', label: 'Billing', icon: Sparkles },
  { href: '/autonomy', label: 'Autonomy', icon: Zap },
  { href: '/docs', label: 'Docs', icon: BookOpen, newTab: true },
  { href: '/settings', label: 'Settings', icon: Settings },
];

export function NavRail() {
  const pathname = usePathname();
  const realOnly = useDashboard(s => s.realOnly);
  const [opsOpen, setOpsOpen] = useState(false);

  const { data: counts } = useSmartPoll<NavCounts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  // Auto-open OPS if you navigated into one of its items.
  useEffect(() => {
    if (OPS.items.some((i) => pathname.startsWith(i.href))) setOpsOpen(true);
  }, [pathname]);

  return (
    <nav className="nav-rail fixed left-0 top-[var(--header-height)] bottom-0 w-[var(--nav-width)] bg-card border-r border-border z-40 hidden md:flex flex-col">
      <div className="flex-1 overflow-y-auto px-2 py-3">
        {PRIMARY.map((group, idx) => (
          <NavGroupBlock
            key={group.label}
            group={group}
            counts={counts ?? null}
            pathname={pathname}
            className={idx > 0 ? 'mt-3 pt-3 border-t border-border/40' : ''}
          />
        ))}

        {/* Collapsible OPS group */}
        <div className="mt-3 pt-3 border-t border-border/40">
          <button
            type="button"
            onClick={() => setOpsOpen((v) => !v)}
            className="w-full flex items-center justify-between px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold hover:text-muted-foreground"
          >
            <span>OPS</span>
            {opsOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          </button>
          {opsOpen && (
            <div className="space-y-0.5 mt-1" data-stagger>
              {OPS.items.map((item) => (
                <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} count={0} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM fixed group — Connections / Billing / Autonomy / Settings */}
      <div className="px-2 py-2 border-t border-border/60 space-y-0.5">
        {BOTTOM.map((item) => (
          <NavLink key={item.href} item={item} active={pathname.startsWith(item.href)} count={0} compact />
        ))}
      </div>

      <UserCard />
    </nav>
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

function NavGroupBlock({ group, counts, pathname, className }:
  { group: NavGroup; counts: NavCounts | null; pathname: string; className?: string }) {
  return (
    <div className={className}>
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{group.label}</div>
      <div className="space-y-0.5">
        {group.items.map((item) => {
          const active = isItemActive(item, pathname);
          const count = item.countKey && counts ? counts[item.countKey] : 0;
          return <NavLink key={item.href} item={item} active={active} count={count} />;
        })}
      </div>
    </div>
  );
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
