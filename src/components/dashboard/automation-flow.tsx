'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Radio, Search, FileText, ClipboardCheck, Send, BarChart3, Rocket, ArrowUpRight, CheckCircle2, Loader2 } from 'lucide-react';
import { AgentOrb, type Department } from '@/components/agent-orb';

// WaveSpec shape from lib/waves.ts (`label` not `name`; no per-wave status here —
// we derive `running`/`done` from the mission's `current_wave` index below).
interface WaveSpec { label: string; agents?: Array<{ agentId: string; task: string }>; brief?: string }
interface Mission {
  id: string; title: string; status: string;
  current_wave: number; total_waves: number;
  goal_id: string | null; updated_at: string;
  waves?: WaveSpec[];
}

// The Missions strip on Overview. Top: the active mission's waves rendered as
// a connected pipeline (what's running right now). Bottom: the 3 most recent
// missions in any state, each a tappable row that deep-links to /missions.
// Falls back to a 5-step demo + "Launch one" CTA when no missions have run.

const DEMO_WAVES: Array<{ name: string; dept: Department; icon: typeof Search }> = [
  { name: 'Market Research',  dept: 'marketing',         icon: Search },
  { name: 'Lead Generation',  dept: 'revenue',           icon: FileText },
  { name: 'Onboarding',       dept: 'operations',        icon: ClipboardCheck },
  { name: 'Client Success',   dept: 'client_experience', icon: Send },
  { name: 'Growth Analysis',  dept: 'leadership',        icon: BarChart3 },
];

export function AutomationFlow() {
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch('/api/missions', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (!cancel) setMissions(Array.isArray(j.missions) ? j.missions : []); })
        .catch(() => { if (!cancel) setMissions([]); })
        .finally(() => { if (!cancel) setLoading(false); });
    };
    load();
    const t = setInterval(load, 15_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const active = missions?.find((m) => m.status === 'running') ?? null;
  const live = !!active;
  const recent = (missions ?? []).filter((m) => m.id !== active?.id).slice(0, 3);
  const total = missions?.length ?? 0;

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="flex items-center gap-2 w-full">
          <Rocket size={14} className="text-[var(--primary)]" />
          <h3 className="text-sm font-semibold">Missions</h3>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium" style={{ color: live ? 'var(--primary)' : 'var(--muted-foreground)' }}>
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: live ? 'var(--primary)' : 'var(--muted-foreground)' }} />
            <Radio size={12} /> {live ? 'Live' : 'Idle'}
          </span>
          {total > 0 && <span className="badge badge-neutral text-[10px] ml-1">{total} total</span>}
          <Link
            href="/missions"
            className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            style={{ transition: 'color var(--t-popover) var(--ease-out)' }}
          >
            Open Missions <ArrowUpRight size={11} />
          </Link>
        </div>
      </div>

      <div className="panel-body space-y-4">
        {/* Pipeline of the currently-running mission. Falls back to a demo strip
            when nothing's live so the page never reads empty. */}
        <ActivePipeline active={active} />

        {/* Recent missions tail — compact rows, click-through to detail. */}
        {loading && !missions ? (
          <div className="py-4 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading missions…
          </div>
        ) : total === 0 ? (
          <Link
            href="/missions"
            className="rounded-lg border border-dashed border-border/60 p-3 flex items-center justify-between gap-3 group focus-ring"
            style={{ transition: 'background-color var(--t-popover) var(--ease-out), border-color var(--t-popover) var(--ease-out)' }}
          >
            <div className="flex items-center gap-2.5">
              <Rocket size={14} className="text-[var(--primary)]" />
              <div>
                <div className="text-xs font-medium">Launch your first mission</div>
                <p className="text-micro text-muted-foreground">Multi-agent research + drafting in one go.</p>
              </div>
            </div>
            <ArrowUpRight size={12} className="text-muted-foreground group-hover:text-foreground" style={{ transition: 'color var(--t-popover) var(--ease-out)' }} />
          </Link>
        ) : recent.length > 0 ? (
          <div className="space-y-1.5">
            <div className="text-micro text-muted-foreground px-1">Recent missions</div>
            {recent.map((m) => <MissionRow key={m.id} m={m} />)}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ActivePipeline({ active }: { active: Mission | null }) {
  // When a mission is running, render its actual waves; per-wave status is
  // derived from the mission's `current_wave` cursor (waves before it = done,
  // at it = running, after = pending). When idle, fall back to the canonical
  // 5-step demo so the operator sees what a mission looks like.
  const waves = active?.waves?.length ? active.waves : null;
  const cursor = active?.current_wave ?? 0;
  const nodes = waves
    ? waves.slice(0, 5).map((w, i) => ({
        name: w.label,
        dept: DEMO_WAVES[i % DEMO_WAVES.length].dept,
        icon: DEMO_WAVES[i % DEMO_WAVES.length].icon,
        running: i === cursor && active?.status === 'running',
        done: i < cursor,
      }))
    : DEMO_WAVES.map((w) => ({ ...w, running: false, done: false }));

  return (
    <div>
      {active && (
        <div className="text-micro text-muted-foreground px-1 mb-1.5 truncate">
          Now running · {active.title} · wave {active.current_wave + 1} of {active.total_waves}
        </div>
      )}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {nodes.map((n, i) => {
          const Icon = n.icon;
          return (
            <div key={i} className="flex items-center gap-2 shrink-0">
              <div
                className="flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg border bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] min-w-[140px]"
                style={{ borderColor: n.running ? 'color-mix(in srgb, var(--primary) 40%, var(--border))' : 'color-mix(in srgb, var(--border) 60%, transparent)' }}
              >
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
              {i < nodes.length - 1 && <Arrow live={n.running || n.done} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function MissionRow({ m }: { m: Mission }) {
  const pct = m.total_waves > 0 ? Math.round((m.current_wave / m.total_waves) * 100) : 0;
  const meta = STATUS_META[m.status] ?? STATUS_META.default;
  return (
    <Link
      href={`/missions`}
      className="block rounded-lg border border-border/50 p-2.5 group focus-ring"
      style={{ transition: 'background-color var(--t-popover) var(--ease-out), border-color var(--t-popover) var(--ease-out)' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color, boxShadow: m.status === 'running' ? `0 0 6px ${meta.color}` : undefined }} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium truncate">{m.title}</div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-2">
            <span style={{ color: meta.color }}>{meta.label}</span>
            <span>·</span>
            <span>wave {m.current_wave}/{m.total_waves}</span>
            <span>·</span>
            <span>{relTime(m.updated_at)}</span>
          </div>
        </div>
        <div className="w-16 shrink-0">
          <div className="h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
            <div className="h-full" style={{ width: `${pct}%`, background: meta.color }} />
          </div>
        </div>
      </div>
    </Link>
  );
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  running: { label: 'running', color: 'var(--primary)' },
  done:    { label: 'done',    color: 'var(--primary)' },
  error:   { label: 'error',   color: 'var(--destructive)' },
  paused:  { label: 'paused',  color: 'var(--warning)' },
  default: { label: 'idle',    color: 'var(--muted-foreground)' },
};

function relTime(iso: string): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const s = Math.max(1, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function Arrow({ live }: { live: boolean }) {
  const c = live ? 'var(--primary)' : 'color-mix(in srgb, var(--border) 80%, transparent)';
  return (
    <svg width="40" height="14" viewBox="0 0 40 14" aria-hidden style={{ flexShrink: 0 }}>
      <line x1="0" y1="7" x2="32" y2="7" stroke={c} strokeWidth="1.2" strokeDasharray="4 3" />
      <polyline points="28,3 36,7 28,11" fill="none" stroke={c} strokeWidth="1.2" />
    </svg>
  );
}
