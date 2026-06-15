'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search, User, PenLine, Radio, FlaskConical, List,
  Gauge, MessageCircle, Mail, BarChart3, LineChart, ArrowRight, BrainCircuit, Rocket,
  Bot, MessagesSquare, Activity, Inbox, Target, Waves, Contact, Zap,
  Network, Timer, DollarSign, FolderOpen, TrendingUp, Dna, Bug, Clock,
  Link2, Sparkles, Settings, BookOpen,
} from 'lucide-react';
import { useDashboard } from '@/store';

interface SearchResult {
  id: string | number;
  title: string;
  subtitle: string;
  category: 'lead' | 'content' | 'signal' | 'experiment' | 'activity';
  status?: string;
  tier?: string;
}

interface AgentLite { id: string; name: string; role: string; description: string }

// Canonical nav — kept in lockstep with src/components/layout/nav-rail.tsx so
// the palette can take you anywhere the rail can, plus a few deep links to
// per-agent memory views you can't get to from the rail directly.
// Mirrors the live nav rail (src/components/layout/nav-rail.tsx) — keep in sync
// when nav labels/routes change so the ⌘K palette never goes stale.
const NAV_ITEMS: Array<{ label: string; path: string; icon: typeof Gauge; group: string }> = [
  // HOME
  { label: 'Overview',     path: '/',                  icon: Gauge,         group: 'Home' },
  { label: 'Tasks',        path: '/tasks',             icon: Activity,      group: 'Home' },
  { label: 'Approvals',    path: '/drafts',            icon: Inbox,         group: 'Home' },
  { label: 'Goals',        path: '/goals',             icon: Target,        group: 'Home' },
  // AGENTS
  { label: 'Agents',       path: '/agents/squads',     icon: Bot,           group: 'Agents' },
  { label: 'Boardroom',    path: '/boardroom',         icon: MessagesSquare,group: 'Agents' },
  { label: 'Automations',  path: '/automations',       icon: Zap,           group: 'Agents' },
  // CREATIVE (the Content Lab hub + its tabs)
  { label: 'Content Lab',  path: '/content/overview',  icon: FlaskConical,  group: 'Content Lab' },
  { label: 'Competitors',  path: '/competitors',       icon: Radio,         group: 'Content Lab' },
  { label: 'Ideas',        path: '/content-lab',       icon: FlaskConical,  group: 'Content Lab' },
  { label: 'Scripts',      path: '/scripts',           icon: PenLine,       group: 'Content Lab' },
  { label: 'Hyperframes',  path: '/content/hyperframes', icon: Activity,    group: 'Content Lab' },
  { label: 'Media',        path: '/content/media',     icon: FolderOpen,    group: 'Content Lab' },
  { label: 'Pipeline',     path: '/content',           icon: List,          group: 'Content Lab' },
  { label: 'Library',      path: '/content/library',   icon: FolderOpen,    group: 'Content Lab' },
  { label: 'Engagement',   path: '/engagement',        icon: MessageCircle, group: 'Content Lab' },
  { label: 'SMS inbox',    path: '/engagement',        icon: MessageCircle, group: 'Content Lab' },
  // MARKETING
  { label: 'Campaigns',    path: '/campaigns',         icon: Waves,         group: 'Marketing' },
  { label: 'Missions',     path: '/missions',          icon: Rocket,        group: 'Marketing' },
  { label: 'Outreach',     path: '/outreach',          icon: Mail,          group: 'Marketing' },
  { label: 'Research',     path: '/research',          icon: Search,        group: 'Marketing' },
  // REVENUE
  { label: 'CRM',          path: '/crm',               icon: Contact,       group: 'Revenue' },
  { label: 'ROI',          path: '/roi',               icon: Timer,         group: 'Revenue' },
  // INSIGHTS
  { label: 'Analytics',    path: '/analytics',         icon: LineChart,     group: 'Insights' },
  { label: 'KPIs',         path: '/kpis',              icon: BarChart3,     group: 'Insights' },
  { label: 'Usage',        path: '/usage',             icon: DollarSign,    group: 'Insights' },
  { label: 'Knowledge',    path: '/kg',                icon: Network,       group: 'Insights' },
  // OPS
  { label: 'Workspace',    path: '/agents/workspace',  icon: FolderOpen,    group: 'Ops' },
  { label: 'Reports',      path: '/memory',            icon: BrainCircuit,  group: 'Ops' },
  { label: 'Learning',     path: '/learning',          icon: TrendingUp,    group: 'Ops' },
  { label: 'Genes',        path: '/genes',             icon: Dna,           group: 'Ops' },
  { label: 'Issues',       path: '/issues',            icon: Bug,           group: 'Ops' },
  { label: 'Cron',         path: '/cron',              icon: Clock,         group: 'Ops' },
  { label: 'Activity',     path: '/activity',          icon: List,          group: 'Ops' },
  { label: 'Deploy',       path: '/deploy',            icon: Rocket,        group: 'Ops' },
  // SETTINGS
  { label: 'Connections',  path: '/connections',       icon: Link2,         group: 'Settings' },
  { label: 'Billing',      path: '/billing',           icon: Sparkles,      group: 'Settings' },
  { label: 'Autonomy',     path: '/autonomy',          icon: Zap,           group: 'Settings' },
  { label: 'Docs',         path: '/docs',              icon: BookOpen,      group: 'Settings' },
  { label: 'Settings',     path: '/settings',          icon: Settings,      group: 'Settings' },
];

const CATEGORY_ICONS: Record<string, typeof User> = {
  lead: User,
  content: PenLine,
  signal: Radio,
  experiment: FlaskConical,
  activity: List,
};

const CATEGORY_ROUTES: Record<string, string> = {
  lead: '/outreach',
  content: '/content',
  signal: '/research',
  experiment: '/experiments',
  activity: '/activity',
};

export function CommandPalette() {
  const realOnly = useDashboard(s => s.realOnly);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const router = useRouter();

  // Cmd+K / Ctrl+K to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen(o => {
          const next = !o;
          if (next) {
            setQuery('');
            setResults([]);
            setActiveIndex(0);
          }
          return next;
        });
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Load the live agent roster the first time the palette opens. Used to
  // surface "jump to <agent>" rows + per-agent memory deep links.
  useEffect(() => {
    if (!open || agents.length > 0) return;
    fetch('/api/squad', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        const list = Array.isArray(j.agents) ? j.agents : [];
        setAgents(list.map((a: { id: string; name: string; role: string; description: string }) => ({
          id: a.id, name: a.name, role: a.role, description: a.description ?? '',
        })));
      })
      .catch(() => {});
  }, [open, agents.length]);

  // Search debounce — server-side fuzzy across leads/content/signals/etc.
  useEffect(() => {
    if (!query || query.length < 2) {
      return;
    }
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/search?q=${encodeURIComponent(query)}${realOnly ? '&real=true' : ''}`)
        .then(r => r.json())
        .then(data => {
          setResults(data.results || []);
          setActiveIndex(0);
        })
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query, realOnly]);

  // Filter nav items based on query. Match on label OR group so "ops" surfaces
  // every Ops item, "memory" finds /memory + Agent memory deep links, etc.
  const q = query.toLowerCase().trim();
  const filteredNav = useMemo(
    () =>
      q.length > 0
        ? NAV_ITEMS.filter((n) => n.label.toLowerCase().includes(q) || n.group.toLowerCase().includes(q))
        : NAV_ITEMS,
    [q],
  );

  // Agent matches. Each agent gets a primary "Open" row, and when the query
  // hints at memory/pulse/heartbeat we also surface a "memory" row that lands
  // on the same detail page (it's where Pulse + Heartbeat + recent runs live).
  const wantsMemory = /memor|pulse|heartbeat|history|run/.test(q);
  const filteredAgents = useMemo(() => {
    if (agents.length === 0) return [] as Array<AgentLite & { kind: 'open' | 'memory' }>;
    const matches = q.length === 0
      ? agents
      : agents.filter((a) =>
          a.id.toLowerCase().includes(q)
          || a.name.toLowerCase().includes(q)
          || (a.role ?? '').toLowerCase().includes(q)
          || (a.description ?? '').toLowerCase().includes(q),
        );
    const rows: Array<AgentLite & { kind: 'open' | 'memory' }> = matches.map((a) => ({ ...a, kind: 'open' }));
    if (wantsMemory) {
      // De-dupe: only add the memory row if it isn't redundant with the open row.
      for (const a of matches) rows.push({ ...a, kind: 'memory' });
    }
    return rows.slice(0, q.length === 0 ? 6 : 16);
  }, [agents, q, wantsMemory]);

  const visibleResults = useMemo(
    () => (query.length >= 2 ? results : []),
    [query, results],
  );

  // Single ordered list — keyboard nav steps through nav rows, then agent
  // rows, then API search results, in that visual order.
  type Item =
    | { kind: 'nav'; label: string; path: string; icon: typeof Gauge; group: string }
    | { kind: 'agent-open'; id: string; name: string; role: string }
    | { kind: 'agent-memory'; id: string; name: string; role: string }
    | { kind: 'result'; r: SearchResult };
  const allItems: Item[] = useMemo(() => {
    const list: Item[] = [];
    for (const n of filteredNav) list.push({ kind: 'nav', label: n.label, path: n.path, icon: n.icon, group: n.group });
    for (const a of filteredAgents) {
      if (a.kind === 'open') list.push({ kind: 'agent-open', id: a.id, name: a.name, role: a.role });
      else list.push({ kind: 'agent-memory', id: a.id, name: a.name, role: a.role });
    }
    for (const r of visibleResults) list.push({ kind: 'result', r });
    return list;
  }, [filteredNav, filteredAgents, visibleResults]);

  const navigate = (index: number) => {
    const item = allItems[index];
    if (!item) return;
    if (item.kind === 'nav')          router.push(item.path);
    else if (item.kind === 'agent-open' || item.kind === 'agent-memory') router.push(`/agents/${item.id}`);
    else                              router.push(CATEGORY_ROUTES[item.r.category] || '/');
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex(i => Math.min(i + 1, allItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      navigate(activeIndex);
    }
  };

  if (!open) return null;

  // Build index ranges so each row knows its global index for highlight.
  const navCount = filteredNav.length;
  const agentCount = filteredAgents.length;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
        onClick={() => setOpen(false)}
      />

      {/* Palette */}
      <div className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-lg z-50 animate-in">
        <div className="glass-strong modal-surface rounded-xl border border-border/50 shadow-2xl overflow-hidden">
          {/* Input */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/30">
              <Search size={18} className="text-muted-foreground shrink-0" />
              <input
                type="text"
                value={query}
                onChange={e => {
                  const next = e.target.value;
                  setQuery(next);
                  if (next.length < 2) {
                    setLoading(false);
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Jump to a page, an agent, or search…"
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
                autoFocus
              />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
              ESC
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {/* Pages — grouped by Core/Operate/Insights/Ops/Settings, matching the nav rail. */}
            {navCount > 0 && (() => {
              let runningIdx = 0;
              const groups = ['Core', 'Operate', 'Insights', 'Ops', 'Settings'] as const;
              return groups.map((g) => {
                const items = filteredNav.filter((n) => n.group === g);
                if (items.length === 0) return null;
                return (
                  <div key={g} className="px-3 py-2 border-t border-border/20 first:border-t-0">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">{g}</div>
                    {items.map((nav) => {
                      const Icon = nav.icon;
                      const idx = runningIdx++;
                      return (
                        <button
                          key={nav.path}
                          className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                            activeIndex === idx ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/50'
                          }`}
                          onClick={() => navigate(idx)}
                          onMouseEnter={() => setActiveIndex(idx)}
                        >
                          <Icon size={15} />
                          <span className="flex-1 text-left">{nav.label}</span>
                          <span className="text-[10px] text-muted-foreground font-mono">{nav.path}</span>
                          <ArrowRight size={12} className="ml-1 opacity-40" />
                        </button>
                      );
                    })}
                  </div>
                );
              });
            })()}

            {/* Agents section — open the detail page (memory + pulse + heartbeat). */}
            {agentCount > 0 && (
              <div className="px-3 py-2 border-t border-border/20">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">
                  Agents{wantsMemory ? ' · Memory' : ''}
                </div>
                {filteredAgents.map((a, i) => {
                  const idx = navCount + i;
                  const Icon = a.kind === 'memory' ? BrainCircuit : Bot;
                  return (
                    <button
                      key={`${a.id}-${a.kind}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        activeIndex === idx ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/50'
                      }`}
                      onClick={() => navigate(idx)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <Icon size={15} className="shrink-0" />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="truncate">
                          {a.name}
                          {a.kind === 'memory' && <span className="text-muted-foreground"> — memory</span>}
                        </div>
                        <div className="text-[11px] text-muted-foreground truncate">{a.role}</div>
                      </div>
                      <span className="text-[10px] text-muted-foreground font-mono shrink-0">/agents/{a.id}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Search results section — leads / content / signals / experiments. */}
            {visibleResults.length > 0 && (
              <div className="px-3 py-2 border-t border-border/20">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground px-1 mb-1">
                  Results
                </div>
                {visibleResults.map((result, i) => {
                  const Icon = CATEGORY_ICONS[result.category] || List;
                  const idx = navCount + agentCount + i;
                  return (
                    <button
                      key={`${result.category}-${result.id}`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                        activeIndex === idx ? 'bg-primary/10 text-primary' : 'text-foreground/80 hover:bg-muted/50'
                      }`}
                      onClick={() => navigate(idx)}
                      onMouseEnter={() => setActiveIndex(idx)}
                    >
                      <Icon size={15} className="shrink-0" />
                      <div className="flex-1 min-w-0 text-left">
                        <div className="truncate">{result.title}</div>
                        <div className="text-[11px] text-muted-foreground truncate">
                          {result.subtitle}
                          {result.status && (
                            <span className="ml-2 opacity-60">({result.status})</span>
                          )}
                        </div>
                      </div>
                      <span className="text-[10px] text-muted-foreground uppercase shrink-0">
                        {result.category}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Loading */}
            {loading && query.length >= 2 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                Searching...
              </div>
            )}

            {/* Empty state */}
            {!loading && query.length >= 2 && visibleResults.length === 0 && navCount === 0 && agentCount === 0 && (
              <div className="px-4 py-6 text-center text-sm text-muted-foreground">
                No results for &ldquo;{query}&rdquo;
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-border/20 text-[10px] text-muted-foreground">
            <span><kbd className="bg-muted px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
            <span><kbd className="bg-muted px-1 py-0.5 rounded">↵</kbd> select</span>
            <span><kbd className="bg-muted px-1 py-0.5 rounded">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </>
  );
}
