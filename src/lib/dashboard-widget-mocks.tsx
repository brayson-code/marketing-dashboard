'use client';

// Dashboard widget MOCK PREVIEWS — the visual-library data source for the
// "Customize" gallery (src/components/dashboard/widget-menu.tsx).
//
// Every real overview widget owns its own data (fetch + poll). That makes them
// unusable as a live gallery: they'd fire real /api calls, flash spinners, and —
// worse — most self-suppress when their tenant data is empty (KnowledgeMiniMap,
// DepartmentRoster, etc. return null), so a text-free tenant would see a blank
// gallery. So instead of rendering the live components, this module renders a
// lightweight, self-contained STATIC snapshot of each widget with representative
// MOCK data. No network, no polling, no empty-state suppression — every card in
// the gallery always shows something visually representative.
//
// PURE-ish: client-only (JSX), reuses the same panel/badge utility classes and the
// presentational AgentOrb, but imports NOTHING that fetches. Keyed by the registry
// widget `id` (src/lib/dashboard-widgets.ts) so the gallery + drag overlay resolve
// a preview/icon straight from the same id the layout persists.

import type { ComponentType } from 'react';
import {
  Activity, Sparkles, Star, Users, Inbox, ListChecks, BarChart3, Telescope,
  FlaskConical, MessagesSquare, Rocket, Gauge, Network, Users2,
  Target, PlayCircle, TrendingUp, CheckCircle2, Circle, Check, Send,
  Eye, Film, Flame, Lightbulb, Smartphone, Radio, ChevronRight, Search,
  ClipboardCheck, ArrowUpRight, MessageCircle, Mic, type LucideIcon,
} from 'lucide-react';
import { AgentOrb, type Department } from '@/components/agent-orb';

export interface WidgetMock {
  /** Compact glyph — used by the drag overlay card and as a gallery fallback. */
  icon: LucideIcon;
  /** Static, self-contained representative render (no fetch, no poll). */
  Preview: ComponentType;
}

// ─── shared mock primitives ──────────────────────────────────────────────────

function StatTile({ label, value, icon: Icon }: { label: string; value: string; icon?: LucideIcon }) {
  return (
    <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
      <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        {Icon && <Icon size={10} />} {label}
      </div>
      <div className="text-lg font-semibold mt-0.5 tabular-nums">{value}</div>
    </div>
  );
}

function Chip({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium leading-none border"
      style={{
        background: `color-mix(in srgb, ${color} 15%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 45%, transparent)`,
      }}
    >
      {label} <span className="opacity-70 font-mono">×{count}</span>
    </span>
  );
}

function MiniAgentCard({ dept, name, role, runs }: { dept: Department; name: string; role: string; runs: number }) {
  return (
    <div className="panel p-3 flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-xs font-semibold truncate">{name}</div>
          <div className="text-[10px] text-muted-foreground truncate">{role}</div>
        </div>
        <AgentOrb department={dept} size="md" pulse={false} />
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums">{runs} runs · 7d</div>
    </div>
  );
}

function PanelHeader({ icon: Icon, title, right }: { icon: LucideIcon; title: string; right?: string }) {
  return (
    <div className="panel-header items-center">
      <h3 className="text-sm font-semibold flex items-center gap-2">
        <Icon size={14} className="text-[var(--primary)]" /> {title}
      </h3>
      {right && (
        <span className="text-[10px] text-[var(--primary)] inline-flex items-center gap-0.5">
          {right} <ChevronRight size={11} />
        </span>
      )}
    </div>
  );
}

// ─── per-widget previews ─────────────────────────────────────────────────────

function KpiStripMock() {
  const cells = [
    { label: 'System Status', value: 'Optimal', caption: 'All systems operational', icon: Target, color: 'var(--primary)' },
    { label: 'Agents Active', value: '4', caption: 'Of 6 in this lens', icon: Users, color: 'var(--primary)' },
    { label: 'In Flight', value: '2', caption: '1 mission · 3 sub-tasks', icon: PlayCircle, color: 'var(--info, #6aa9ff)' },
    { label: 'Approvals Needed', value: '3', caption: 'Require your attention', icon: Inbox, color: 'var(--warning)' },
    { label: 'Goal Progress', value: '78%', caption: 'On track', icon: TrendingUp, color: 'var(--primary)' },
  ];
  return (
    <div className="panel">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 divide-y sm:divide-y-0 sm:divide-x divide-border/40">
        {cells.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.label} className="p-5 flex items-start justify-between gap-3">
              <div className="space-y-1">
                <div className="text-[11px] font-medium text-muted-foreground">{c.label}</div>
                <div className="text-3xl font-semibold tracking-tight leading-none" style={{ color: c.color }}>{c.value}</div>
                <div className="text-[11px] text-muted-foreground">{c.caption}</div>
              </div>
              <Icon size={18} className="mt-1 shrink-0" style={{ color: c.color }} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function QuickWinMock() {
  const accent = 'var(--primary)';
  const milestones = ['Launch mission', 'Review a draft', 'Approve it', 'Publish it', 'First win'];
  return (
    <div className="panel relative overflow-hidden p-5" data-live="true">
      <div className="relative space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-full shrink-0"
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}>
            <Sparkles size={18} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-h2">Get your first quick win</h2>
              <span className="badge text-[10px]" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)` }}>in 72 hours</span>
            </div>
            <p className="text-small">Approve a draft and publish it within 72 hours.</p>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-4 items-center">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Time remaining</div>
            <div className="tabular-nums leading-none font-semibold tracking-tight"
              style={{ color: 'var(--dept-leadership)', fontSize: '2.25rem', textShadow: `0 0 24px color-mix(in srgb, var(--dept-leadership) 55%, transparent)` }}>
              47:12:38
            </div>
            <div className="text-[10px] text-muted-foreground">tick · tock</div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-micro">
              <span className="text-muted-foreground">2 of 5 done</span>
              <span className="font-mono tabular-nums" style={{ color: accent }}>40%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
              <div className="h-full rounded-full" style={{ width: '40%', background: accent, boxShadow: `0 0 14px ${accent}` }} />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {milestones.map((label, i) => {
            const done = i < 2;
            const c = `var(${['--dept-leadership', '--dept-marketing', '--dept-revenue', '--dept-operations', '--dept-client-experience'][i]})`;
            return (
              <div key={label} className="rounded-lg p-2.5 flex items-start gap-2"
                style={{ border: `1px solid color-mix(in srgb, ${c} ${done ? 55 : 28}%, transparent)`, background: `color-mix(in srgb, ${c} ${done ? 14 : 7}%, var(--surface-2))` }}>
                {done ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: c }} /> : <Circle size={14} className="shrink-0 mt-0.5" style={{ color: c, opacity: 0.6 }} />}
                <div className={`text-[11px] font-medium leading-snug ${done ? 'line-through opacity-60' : ''}`}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NorthStarMock() {
  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="panel relative overflow-hidden p-5 flex flex-col gap-3">
        <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(420px circle at 0% -20%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 55%)' }} />
        <div className="relative flex items-center gap-2">
          <Star size={14} className="text-[var(--primary)] fill-[var(--primary)]" />
          <span className="text-micro uppercase tracking-wider text-[var(--primary)] font-semibold">North Star</span>
        </div>
        <div className="relative">
          <div className="text-h2 leading-snug">Book 20 qualified demos this quarter</div>
        </div>
        <div className="relative mt-auto space-y-1.5">
          <div className="flex items-center justify-between text-micro">
            <span className="text-muted-foreground">Progress</span>
            <span className="font-mono tabular-nums text-[var(--primary)]">65%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
            <div className="h-full rounded-full" style={{ width: '65%', background: 'var(--primary)', boxShadow: '0 0 12px var(--primary)' }} />
          </div>
        </div>
      </div>
      <div className="col-span-2 grid grid-cols-3 gap-3">
        {[
          { p: 'P0', cat: 'Growth', title: 'Ship the landing-page refresh', pct: 80 },
          { p: 'P1', cat: 'Content', title: 'Publish 3 case studies', pct: 45 },
          { p: 'P1', cat: 'Revenue', title: 'Warm up 50 cold leads', pct: 30 },
        ].map((g) => {
          const isP0 = g.p === 'P0';
          return (
            <div key={g.title} className="panel p-4 flex flex-col gap-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider"
                  style={{ background: isP0 ? 'color-mix(in srgb, var(--warning) 18%, transparent)' : 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)', color: isP0 ? 'var(--warning)' : 'var(--muted-foreground)' }}>{g.p}</span>
                <span className="text-[10px] text-muted-foreground">{g.cat}</span>
              </div>
              <div className="text-xs font-medium leading-snug line-clamp-2">{g.title}</div>
              <div className="mt-auto space-y-1">
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-muted-foreground">active</span>
                  <span className="font-mono tabular-nums">{g.pct}%</span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
                  <div className="h-full rounded-full" style={{ width: `${g.pct}%`, background: 'var(--primary)' }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HeroAgentsMock() {
  const agents: Array<{ dept: Department; name: string; role: string; runs: number }> = [
    { dept: 'leadership', name: 'Atlas', role: 'Chief of Staff', runs: 42 },
    { dept: 'marketing', name: 'Nova', role: 'Content Lead', runs: 31 },
    { dept: 'revenue', name: 'Vale', role: 'Sales Closer', runs: 27 },
    { dept: 'operations', name: 'Cog', role: 'Ops Manager', runs: 19 },
    { dept: 'client_experience', name: 'Echo', role: 'Success Lead', runs: 24 },
  ];
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-3">
      {agents.map((a) => <MiniAgentCard key={a.name} {...a} />)}
    </div>
  );
}

function OperatorQueueMock() {
  const rows = [
    { title: 'LinkedIn post: "5 HVAC myths"', sub: 'Social post · pending', dept: 'marketing' as Department },
    { title: 'Follow-up email to Rivera Co.', sub: 'Email · pending', dept: 'revenue' as Department },
    { title: 'Confirm Tuesday walkthrough', sub: 'Meeting · pending', dept: 'operations' as Department },
  ];
  return (
    <div className="panel flex flex-col">
      <div className="panel-header items-start">
        <div className="flex items-center gap-2">
          <Inbox size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Operator Queue</h3>
          <span className="badge badge-neutral text-[10px]">4</span>
        </div>
      </div>
      <div className="px-4 pt-3 flex items-center gap-1">
        <span className="px-3 py-1.5 rounded-md text-[11px] font-medium inline-flex items-center gap-1" style={{ background: 'color-mix(in srgb, var(--primary) 14%, transparent)', color: 'var(--primary)' }}>Approvals <span className="opacity-60 ml-0.5">3</span></span>
        <span className="px-3 py-1.5 rounded-md text-[11px] font-medium inline-flex items-center gap-1 text-muted-foreground">Needs Retry <span className="opacity-60 ml-0.5">1</span></span>
      </div>
      <div className="panel-body space-y-1.5">
        {rows.map((r) => (
          <div key={r.title} className="flex items-center gap-2.5 p-2.5 rounded-lg">
            <AgentOrb department={r.dept} size="sm" pulse={false} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{r.title}</div>
              <div className="text-[10px] text-muted-foreground truncate">{r.sub}</div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <span className="btn btn-ghost btn-sm inline-flex items-center gap-1"><Check size={11} /> Approve</span>
              <span className="btn btn-primary btn-sm inline-flex items-center gap-1"><Send size={11} /> Publish</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TodaysPrioritiesMock() {
  const items = [
    { title: 'Reply to 3 warm leads', sub: 'Revenue · due today', dept: 'revenue' as Department },
    { title: 'Approve this week’s posts', sub: 'Marketing · 2 drafts', dept: 'marketing' as Department },
    { title: 'Review onboarding checklist', sub: 'Operations · Rivera Co.', dept: 'operations' as Department },
  ];
  return (
    <div className="panel flex flex-col">
      <div className="panel-header">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" /> Today&rsquo;s Priorities
        </h3>
      </div>
      <div className="panel-body space-y-2">
        {items.map((it, i) => (
          <div key={it.title} className="flex items-center gap-3 p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)]">
            <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
            <AgentOrb department={it.dept} size="sm" pulse={false} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">{it.title}</div>
              <div className="text-[10px] text-muted-foreground truncate">{it.sub}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WeeklySnapshotMock() {
  const tiles = [
    { label: 'Impressions', value: '48.2k', delta: '+18.6%' },
    { label: 'Engagement', value: '3.9k', delta: '+27.3%' },
    { label: 'Sends', value: '612', delta: '+9.2%' },
    { label: 'Discoveries', value: '128', delta: '+31.6%' },
  ];
  return (
    <div className="panel flex flex-col">
      <div className="panel-header items-center">
        <h3 className="text-sm font-semibold flex items-center gap-2"><BarChart3 size={14} className="text-[var(--primary)]" /> Weekly Snapshot</h3>
        <span className="text-[10px] text-muted-foreground">This week</span>
      </div>
      <div className="panel-body grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg p-3 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
            <div className="text-[10px] text-muted-foreground">{t.label}</div>
            <div className="text-xl font-semibold mt-0.5">{t.value}</div>
            <div className="text-[10px] text-[var(--primary)] font-medium mt-0.5">▲ {t.delta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CompetitorIntelMock() {
  return (
    <div className="panel flex flex-col">
      <PanelHeader icon={Telescope} title="Competitor Intel" right="View competitors" />
      <div className="panel-body flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Tracked" value="6" />
          <StatTile label="Reels analyzed" value="23" />
        </div>
        <div className="flex items-center gap-3 rounded-lg p-2 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
          <div className="relative h-12 w-12 rounded-md overflow-hidden shrink-0 grid place-items-center text-white/70"
            style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--surface-2)), var(--surface-2))' }}>
            <Film size={16} className="opacity-80" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] text-muted-foreground">Top reel</div>
            <div className="text-xs font-medium truncate">3 signs your AC is about to fail</div>
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1 mt-0.5 tabular-nums"><Eye size={11} /> 412K views</div>
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t border-border/40 pt-2.5">
          <div className="text-[10px] text-muted-foreground">Content squad</div>
          {['Reel Analyst', 'Reel Ideator', 'Reel Optimizer'].map((n) => (
            <div key={n} className="flex items-center gap-2 rounded-md p-1.5 -mx-1.5">
              <AgentOrb department="marketing" size="sm" pulse={false} />
              <span className="text-xs font-medium truncate flex-1">{n}</span>
              <span className="badge badge-neutral text-[9px] shrink-0">agent</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ContentLabMock() {
  const tags = [
    { label: 'before/after', count: 8, color: 'var(--dept-marketing)' },
    { label: 'day-in-life', count: 5, color: 'var(--dept-revenue)' },
    { label: 'myth-busting', count: 4, color: 'var(--dept-operations)' },
    { label: 'price-reveal', count: 3, color: 'var(--dept-leadership)' },
  ];
  return (
    <div className="panel flex flex-col">
      <PanelHeader icon={FlaskConical} title="Content Lab" right="Open Content Lab" />
      <div className="panel-body flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Flame size={11} className="text-[var(--primary)]" /> Trending</div>
          <div className="flex flex-wrap gap-1">{tags.map((t) => <Chip key={t.label} {...t} />)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="Ideas" value="14" icon={Lightbulb} />
          <StatTile label="Scripts written" value="6" />
        </div>
        <div className="border-t border-border/40 pt-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Latest idea</div>
          <p className="text-xs text-foreground/90 line-clamp-2 leading-snug">&ldquo;The $60K mistake every homeowner makes with their furnace&hellip;&rdquo;</p>
        </div>
      </div>
    </div>
  );
}

function EngagementMock() {
  const channels = [
    { label: 'X', count: 12, color: '#1d9bf0' },
    { label: 'LinkedIn', count: 7, color: '#0a66c2' },
    { label: 'Signals', count: 4, color: 'var(--primary)' },
  ];
  return (
    <div className="panel flex flex-col">
      <PanelHeader icon={MessagesSquare} title="Engagement" right="Open Engagement" />
      <div className="panel-body flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1"><Radio size={11} className="text-[var(--primary)]" /> Channels</div>
          <div className="flex flex-wrap gap-1">{channels.map((c) => <Chip key={c.label} {...c} />)}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <StatTile label="SMS threads" value="9" icon={Smartphone} />
          <StatTile label="Awaiting reply" value="3" />
        </div>
        <div className="border-t border-border/40 pt-2.5">
          <div className="text-[10px] text-muted-foreground mb-0.5">Latest inbound</div>
          <p className="text-xs text-foreground/90 line-clamp-2 leading-snug">&ldquo;Hey, can you come out Thursday morning to look at the unit?&rdquo;</p>
        </div>
      </div>
    </div>
  );
}

function AutomationFlowMock() {
  const nodes: Array<{ name: string; dept: Department; icon: LucideIcon; done: boolean; running: boolean }> = [
    { name: 'Market Research', dept: 'marketing', icon: Search, done: true, running: false },
    { name: 'Lead Generation', dept: 'revenue', icon: ListChecks, done: true, running: false },
    { name: 'Onboarding', dept: 'operations', icon: ClipboardCheck, done: false, running: true },
    { name: 'Client Success', dept: 'client_experience', icon: Send, done: false, running: false },
    { name: 'Growth Analysis', dept: 'leadership', icon: BarChart3, done: false, running: false },
  ];
  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2 w-full">
          <Rocket size={14} className="text-[var(--primary)]" />
          <h3 className="text-sm font-semibold">Missions</h3>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--primary)' }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--primary)' }} /> <Radio size={12} /> Live
          </span>
          <span className="badge badge-neutral text-[10px] ml-1">3 total</span>
          <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">Open Missions <ArrowUpRight size={11} /></span>
        </div>
      </div>
      <div className="panel-body space-y-4">
        <div className="flex items-center gap-2 overflow-hidden pb-1">
          {nodes.map((n, i) => {
            const Icon = n.icon;
            return (
              <div key={n.name} className="flex items-center gap-2 shrink-0">
                <div className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg border bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] min-w-[140px]"
                  style={{ borderColor: n.running ? 'color-mix(in srgb, var(--primary) 40%, var(--border))' : 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
                  <div className="flex items-center gap-1.5">
                    <Icon size={13} className={n.done ? 'text-[var(--primary)]' : 'text-muted-foreground'} />
                    <span className="text-xs font-medium">{n.name}</span>
                    {n.done && <CheckCircle2 size={11} className="text-[var(--primary)]" />}
                  </div>
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <AgentOrb department={n.dept} size="sm" pulse={n.running} />
                    <span className="capitalize">{n.dept.replace('_', ' ')}</span>
                  </div>
                </div>
                {i < nodes.length - 1 && (
                  <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden style={{ flexShrink: 0 }}>
                    <line x1="0" y1="7" x2="32" y2="7" stroke={n.done ? 'var(--primary)' : 'color-mix(in srgb, var(--border) 80%, transparent)'} strokeWidth="1.2" strokeDasharray="4 3" />
                    <polyline points="28,3 36,7 28,11" fill="none" stroke={n.done ? 'var(--primary)' : 'color-mix(in srgb, var(--border) 80%, transparent)'} strokeWidth="1.2" />
                  </svg>
                )}
              </div>
            );
          })}
        </div>
        <div className="space-y-1.5">
          <div className="text-micro text-muted-foreground px-1">Recent missions</div>
          {[
            { title: 'Q3 launch research sweep', pct: 100, label: 'done' },
            { title: 'Cold-lead reactivation', pct: 60, label: 'running' },
          ].map((m) => (
            <div key={m.title} className="block rounded-lg border border-border/50 p-2.5">
              <div className="flex items-center gap-2.5">
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--primary)' }} />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium truncate">{m.title}</div>
                  <div className="text-[10px] text-muted-foreground">{m.label} · 2h ago</div>
                </div>
                <div className="w-16 shrink-0">
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
                    <div className="h-full" style={{ width: `${m.pct}%`, background: 'var(--primary)' }} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function UsageMock() {
  const CL = { primary: 'var(--claude-primary)', bright: 'var(--claude-bright)', ink: 'var(--claude-ink)', border: 'var(--claude-border)', dark: 'var(--claude-bg)', fill: 'var(--claude-fill-soft)' };
  const Bar = ({ label, pct, used, max }: { label: string; pct: number; used: string; max: string }) => (
    <div>
      <div className="flex items-end justify-between mb-2 gap-2 flex-wrap">
        <span className="text-lg font-extrabold tracking-tight uppercase inline-flex items-baseline gap-2" style={{ color: CL.bright }}>
          {label}<span className="font-mono" style={{ color: CL.ink, fontSize: '0.95rem' }}>{pct}%</span>
        </span>
        <span className="font-mono font-bold" style={{ color: CL.ink, fontSize: '1.05rem' }}>{used} / {max} <span className="text-xs opacity-60">tokens</span></span>
      </div>
      <div className="relative h-9 rounded-full overflow-hidden" style={{ background: CL.fill, border: `1px solid ${CL.border}` }}>
        <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${CL.bright} 0%, ${CL.primary} 60%, ${CL.primary} 100%)`, boxShadow: `0 0 14px color-mix(in srgb, ${CL.primary} 55%, transparent)` }} />
      </div>
    </div>
  );
  return (
    <div className="panel overflow-hidden" style={{ border: `2px solid ${CL.primary}`, borderRadius: 22, background: CL.dark }}>
      <div className="panel-header flex items-center justify-between" style={{ borderColor: `color-mix(in srgb, ${CL.primary} 35%, transparent)` }}>
        <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
          <Sparkles size={17} style={{ color: CL.primary }} />
          <span style={{ color: CL.bright }}>Usage</span>
        </h3>
        <span className="text-[11px] font-mono font-semibold" style={{ color: CL.primary }}>Claude API · 14d</span>
      </div>
      <div className="panel-body space-y-4">
        <Bar label="Daily limit" pct={38} used="762K" max="2.0M" />
        <Bar label="Weekly limit" pct={61} used="6.1M" max="10.0M" />
      </div>
    </div>
  );
}

function KnowledgeMapMock() {
  const nodes = [
    { x: 60, y: 40 }, { x: 150, y: 90 }, { x: 240, y: 45 }, { x: 110, y: 150 }, { x: 210, y: 155 }, { x: 300, y: 110 },
  ];
  const edges: Array<[number, number]> = [[0, 1], [1, 2], [1, 3], [3, 4], [2, 5], [4, 5]];
  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Network size={14} className="text-[var(--primary)]" />
        <h3 className="text-sm font-semibold">Knowledge map</h3>
        <span className="text-micro text-muted-foreground">what the agents know</span>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">Explore graph <ArrowUpRight size={11} /></span>
      </div>
      <div className="panel-body space-y-2.5">
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span><span className="font-mono tabular-nums font-semibold">37</span> <span className="text-muted-foreground">entities</span></span>
          <span className="text-muted-foreground">·</span>
          <span><span className="font-mono tabular-nums font-semibold">52</span> <span className="text-muted-foreground">relations</span></span>
          <span className="text-muted-foreground">·</span>
          <span className="badge badge-neutral text-[10px]">person <span className="opacity-70">14</span></span>
          <span className="badge badge-neutral text-[10px]">company <span className="opacity-70">9</span></span>
        </div>
        <div className="h-[220px] rounded-lg overflow-hidden" style={{ background: 'color-mix(in srgb, var(--surface-2) 40%, transparent)' }}>
          <svg viewBox="0 0 360 200" width="100%" height="100%" aria-hidden>
            {edges.map(([a, b], i) => (
              <line key={i} x1={nodes[a].x} y1={nodes[a].y} x2={nodes[b].x} y2={nodes[b].y}
                stroke="color-mix(in srgb, var(--primary) 40%, transparent)" strokeWidth="1.2" />
            ))}
            {nodes.map((n, i) => (
              <g key={i}>
                <circle cx={n.x} cy={n.y} r={i === 1 ? 11 : 7} fill="var(--primary)" opacity={0.9} />
                <circle cx={n.x} cy={n.y} r={i === 1 ? 18 : 12} fill="none" stroke="color-mix(in srgb, var(--primary) 35%, transparent)" strokeWidth="1" />
              </g>
            ))}
          </svg>
        </div>
      </div>
    </div>
  );
}

function DepartmentRosterMock() {
  const sections: Array<{ label: string; dept: Department; agents: Array<{ name: string; role: string }> }> = [
    { label: 'Leadership', dept: 'leadership', agents: [{ name: 'Atlas', role: 'Chief of Staff' }, { name: 'Sage', role: 'Strategist' }] },
    { label: 'Marketing', dept: 'marketing', agents: [{ name: 'Nova', role: 'Content Lead' }, { name: 'Pixel', role: 'Designer' }, { name: 'Reel', role: 'Video' }] },
  ];
  return (
    <div className="space-y-6">
      {sections.map((s) => {
        const c = `var(--dept-${s.dept.replace('_', '-')})`;
        return (
          <section key={s.label} className="space-y-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
                style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c, border: `1px solid color-mix(in srgb, ${c} 32%, transparent)` }}>
                <Users2 size={14} />
              </span>
              <h2 className="text-h2">{s.label}</h2>
              <span className="text-small">{s.agents.length} agents</span>
              <span className="ml-2 flex-1 h-px" style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${c} 28%, transparent), transparent)` }} />
            </div>
            <div className="grid grid-cols-3 lg:grid-cols-5 gap-3">
              {s.agents.map((a) => <MiniAgentCard key={a.name} dept={s.dept} name={a.name} role={a.role} runs={20} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

// The real widget is a full-width, Claude-web-app-style board row (a centered
// max-w conversation column inside a generously tall tile) — not a small chat
// tile. The mock mirrors that: a subtle header agent-picker (not a chip row)
// and a centered column, so the gallery preview reads as "this is the
// flagship element of the overview," not just another card.
function AgentChatMock() {
  const accent = 'var(--primary)';
  return (
    <div className="panel flex flex-col">
      <div className="panel-header items-center" style={{ borderColor: `color-mix(in srgb, ${accent} 24%, transparent)` }}>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <MessageCircle size={14} style={{ color: accent }} /> Command Chat
        </h3>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
          <span aria-hidden>🧑‍💼</span> Atlas <ChevronRight size={11} className="rotate-90 opacity-60" />
        </span>
      </div>
      <div className="mx-auto w-full max-w-[420px] px-2 pt-4 pb-3">
        <div className="space-y-2.5">
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-3 py-2 text-xs leading-snug bg-[color-mix(in_srgb,var(--surface-2)_65%,transparent)] border border-border/40">
              Morning — I lined up 3 follow-ups and drafted this week&rsquo;s posts. Want me to send the Rivera Co. quote?
            </div>
          </div>
          <div className="flex justify-end">
            <div className="max-w-[85%] rounded-2xl rounded-tr-sm px-3 py-2 text-xs leading-snug text-[var(--primary-foreground)]" style={{ background: accent }}>
              Yes, send it and book the Thursday walkthrough.
            </div>
          </div>
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-tl-sm px-3 py-2 text-xs leading-snug bg-[color-mix(in_srgb,var(--surface-2)_65%,transparent)] border border-border/40">
              Done. Quote sent, walkthrough on the calendar for 9am Thursday.
            </div>
          </div>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[420px] px-2 pb-4">
        <div
          className="flex items-center gap-2 rounded-2xl px-3 py-2.5"
          style={{ boxShadow: `0 10px 24px -14px color-mix(in srgb, ${accent} 35%, transparent)`, background: 'color-mix(in srgb, var(--surface-2) 55%, transparent)', border: '1px solid var(--border)' }}
        >
          <span className="text-xs text-muted-foreground flex-1">Message Atlas&hellip;</span>
          <Mic size={14} className="text-muted-foreground" />
          <span className="grid place-items-center h-6 w-6 rounded-lg" style={{ background: accent, color: 'var(--primary-foreground)' }}><Send size={12} /></span>
        </div>
      </div>
    </div>
  );
}

// ─── registry: widget id → { icon, Preview } ─────────────────────────────────

export const WIDGET_MOCKS: Record<string, WidgetMock> = {
  kpi_strip: { icon: Activity, Preview: KpiStripMock },
  quick_win: { icon: Sparkles, Preview: QuickWinMock },
  north_star: { icon: Star, Preview: NorthStarMock },
  hero_agents: { icon: Users, Preview: HeroAgentsMock },
  operator_queue: { icon: Inbox, Preview: OperatorQueueMock },
  todays_priorities: { icon: ListChecks, Preview: TodaysPrioritiesMock },
  weekly_snapshot: { icon: BarChart3, Preview: WeeklySnapshotMock },
  competitor_intel: { icon: Telescope, Preview: CompetitorIntelMock },
  content_lab: { icon: FlaskConical, Preview: ContentLabMock },
  engagement: { icon: MessagesSquare, Preview: EngagementMock },
  automation_flow: { icon: Rocket, Preview: AutomationFlowMock },
  usage: { icon: Gauge, Preview: UsageMock },
  knowledge_map: { icon: Network, Preview: KnowledgeMapMock },
  department_roster: { icon: Users2, Preview: DepartmentRosterMock },
  agent_chat: { icon: MessageCircle, Preview: AgentChatMock },
};

/** Compact icon for a widget id (drag overlay / fallback), defaults to a generic glyph. */
export function widgetMock(id: string): WidgetMock | undefined {
  return WIDGET_MOCKS[id];
}
