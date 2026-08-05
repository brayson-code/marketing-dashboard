'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Layers, Loader2, ShieldAlert, ChevronRight, ChevronLeft, Check, Minus,
  Building2, Sparkles, X,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';
import {
  nicheName, categoryName, rosterReason, REASON_LABEL, type RosterReason,
} from '@/lib/niche-catalog';

// Industry Templates — HQ-only, PREVIEW ONLY.
//
// What an operator is here to answer: "if this client is a roofing company, what agents
// would they get, are those agents any good, and what are they missing today?"
//
// There is no apply button and the API has no write path. That's deliberate: the
// rosters have to be judged before anything gets written into a live workspace
// (plans/niche-templates.md). The gap column is the honest part — today it reads
// "missing" for essentially everything, which is the finding that justified building
// this at all.

interface Niche { slug: string; agents: number }
interface Stat { source: string; richness: string; n: number }
interface RosterAgent {
  id: string; name: string; category: string; role: string;
  department: string | null; is_executive: boolean; does: string;
  default_niches: string[]; tags: string[];
  richness: 'thin' | 'rich'; source: string;
}
interface Gap { present: string[]; missing: string[] }
interface Workspace { id: string; name: string; agents: number }
interface FullAgent extends RosterAgent { soul: string; agent_md: string; skills: string }

const REASON_ORDER: Record<RosterReason, number> = { niche: 0, executive: 1, default: 2 };

export default function TemplatesPage() {
  const [niches, setNiches] = useState<Niche[]>([]);
  const [stats, setStats] = useState<Stat[]>([]);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [roster, setRoster] = useState<RosterAgent[]>([]);
  const [gap, setGap] = useState<Gap | null>(null);
  const [tenant, setTenant] = useState<string>('');
  const [openAgent, setOpenAgent] = useState<FullAgent | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/templates');
        if (res.status === 403) { setForbidden(true); return; }
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        setNiches(data.niches ?? []);
        setStats(data.stats ?? []);
        const ws = await fetch('/api/templates?mode=workspaces');
        if (ws.ok) setWorkspaces((await ws.json()).workspaces ?? []);
      } catch {
        setError("Couldn't load the catalogue. Refresh to try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const loadRoster = useCallback(async (slug: string, tenantId: string) => {
    setLoadingRoster(true);
    try {
      const qs = new URLSearchParams({ mode: 'roster', niche: slug });
      if (tenantId) qs.set('tenant', tenantId);
      const res = await fetch(`/api/templates?${qs}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setRoster(data.agents ?? []);
      setGap(data.gap ?? null);
    } catch {
      setError("Couldn't load that industry's roster.");
    } finally {
      setLoadingRoster(false);
    }
  }, []);

  useEffect(() => {
    if (selected) loadRoster(selected, tenant);
  }, [selected, tenant, loadRoster]);

  const openDetail = async (id: string) => {
    try {
      const res = await fetch(`/api/templates?mode=agent&id=${encodeURIComponent(id)}`);
      if (!res.ok) return;
      setOpenAgent((await res.json()).agent ?? null);
    } catch { /* the list still works without the detail */ }
  };

  // Group by why the agent is in the roster: industry-specific rows are the only thing
  // that makes one template different from another, so they lead.
  const grouped = useMemo(() => {
    const by = new Map<RosterReason, RosterAgent[]>();
    for (const a of roster) {
      const r = rosterReason(a);
      if (!by.has(r)) by.set(r, []);
      by.get(r)!.push(a);
    }
    return [...by.entries()].sort((a, b) => REASON_ORDER[a[0]] - REASON_ORDER[b[0]]);
  }, [roster]);

  const nicheCount = useMemo(
    () => roster.filter(a => rosterReason(a) === 'niche').length,
    [roster],
  );
  const totalAgents = useMemo(() => stats.reduce((n, s) => n + s.n, 0), [stats]);

  if (forbidden) {
    return (
      <div className="space-y-4">
        <PageHeader icon={<ShieldAlert size={20} />} title="Industry Templates" />
        <div className="panel p-6 text-sm text-muted-foreground">
          This is an operator surface and isn&apos;t available in this workspace.
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<Layers size={20} />}
        title="Industry Templates"
        subtitle="What a client in a given industry would get. Preview only — nothing here changes a workspace."
      />

      <Explainer
        id="templates"
        title="What this is"
        what={
          <>
            The agent library holds <strong>{totalAgents} agent definitions</strong>, including
            industry-tuned specialists across <strong>{niches.length} industries</strong>. This page
            shows what each industry&apos;s roster looks like and how it compares to a workspace today.
          </>
        }
        when="Before onboarding a client, to see which agents suit their business — and to judge whether the written agents are actually good enough to give someone."
        example="Pick Roofing, then pick a workspace, and read what they'd gain."
      />

      {loading ? (
        <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Loading the catalogue…
        </div>
      ) : error ? (
        <div className="panel p-6 text-sm" style={{ color: 'var(--destructive)' }}>{error}</div>
      ) : !selected ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {niches.map((n) => (
            <button
              key={n.slug}
              onClick={() => setSelected(n.slug)}
              className="panel p-4 text-left hover:bg-[var(--surface-2)] transition-colors flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{nicheName(n.slug)}</p>
                <p className="text-[11px] text-muted-foreground">
                  {n.agents} industry {n.agents === 1 ? 'agent' : 'agents'}
                </p>
              </div>
              <ChevronRight size={15} className="text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => { setSelected(null); setRoster([]); setGap(null); }}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ChevronLeft size={13} /> All industries
            </button>
            <h2 className="text-sm font-semibold">{nicheName(selected)}</h2>
            {nicheCount > 0 && (
              <span className="text-[11px] text-muted-foreground">
                {nicheCount} industry-specific · {roster.length} total
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Building2 size={13} className="text-muted-foreground" />
              <select
                value={tenant}
                onChange={(e) => setTenant(e.target.value)}
                className="text-xs bg-[var(--surface-2)] border border-border rounded-lg px-2 py-1.5"
              >
                <option value="">Compare to a workspace…</option>
                {workspaces.map(w => (
                  <option key={w.id} value={w.id}>{w.name} ({w.agents})</option>
                ))}
              </select>
            </div>
          </div>

          {gap && (
            <div className="panel p-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className="font-semibold">Against that workspace:</span>
              <span className="flex items-center gap-1.5">
                <Check size={12} style={{ color: 'var(--success, var(--primary))' }} />
                {gap.present.length} already there
              </span>
              <span className="flex items-center gap-1.5" style={{ color: 'var(--warning)' }}>
                <Minus size={12} /> {gap.missing.length} missing
              </span>
            </div>
          )}

          {loadingRoster ? (
            <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={16} className="animate-spin" /> Loading roster…
            </div>
          ) : (
            grouped.map(([reason, agents]) => (
              <div key={reason} className="space-y-1.5">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  {reason === 'niche' && <Sparkles size={11} className="text-[var(--primary)]" />}
                  {REASON_LABEL[reason]} ({agents.length})
                </p>
                <div className="grid gap-2 md:grid-cols-2">
                  {agents.map((a) => {
                    const missing = gap?.missing.includes(a.id);
                    return (
                      <button
                        key={a.id}
                        onClick={() => openDetail(a.id)}
                        className="panel p-3 text-left hover:bg-[var(--surface-2)] transition-colors"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-medium">{a.name}</p>
                          {gap && (
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                              style={missing
                                ? { color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 12%, transparent)' }
                                : { color: 'var(--muted-foreground)', background: 'var(--surface-2)' }}
                            >
                              {missing ? 'missing' : 'has it'}
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{a.does}</p>
                        <p className="text-[10px] text-muted-foreground mt-1.5">
                          {categoryName(a.category)}
                          {a.richness === 'thin' && ' · outline only'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {openAgent && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
          style={{ background: 'color-mix(in srgb, black 55%, transparent)' }}
          onClick={() => setOpenAgent(null)}
        >
          <div
            className="panel max-w-3xl w-full p-5 space-y-4 my-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold">{openAgent.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">{openAgent.does}</p>
              </div>
              <button onClick={() => setOpenAgent(null)} className="text-muted-foreground hover:text-foreground shrink-0">
                <X size={16} />
              </button>
            </div>

            {/* The actual prompt bodies. This is the point of the page — a roster count
                proves nothing, reading what the agent is told to be proves a lot. */}
            {([
              ['Identity and voice', openAgent.soul],
              ['How it behaves', openAgent.agent_md],
              ['Playbooks', openAgent.skills],
            ] as const).map(([label, body]) => body ? (
              <div key={label} className="space-y-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
                <pre className="text-[11px] leading-relaxed whitespace-pre-wrap font-sans bg-[var(--surface-2)] rounded-lg p-3 max-h-72 overflow-y-auto">
                  {body}
                </pre>
              </div>
            ) : null)}

            {openAgent.default_niches.length > 0 && (
              <p className="text-[11px] text-muted-foreground">
                Used by: {openAgent.default_niches.map(nicheName).join(' · ')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
