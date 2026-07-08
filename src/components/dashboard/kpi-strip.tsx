'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Users, Inbox, Target, TrendingUp, PlayCircle } from 'lucide-react';
import type { Department } from '@/components/agent-orb';

interface HeroAgent {
  id: string; name: string; status: string;
  heartbeat?: { ts: number; kind: string; message: string } | null;
}
interface Counts { content: number; outreach: number; signals_today: number; new_leads: number; total_pending: number }
interface Hud {
  approvals_pending: number;
  approvals_stale: number;
  in_flight: number;
  missions_running: number;
  tasks_running: number;
  waves_pending: number;
}
interface Goal { id: string; status: 'active' | 'pending_verification' | 'done' | 'abandoned' }

// One wide row of 5 KPI cells separated by subtle dividers. This is the "is
// everything OK right now?" hero glance. Numbers are real and refresh on a
// gentle poll; nothing here is mocked.
export function KpiStrip({ department }: { department: Department }) {
  const [agents, setAgents] = useState<HeroAgent[]>([]);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [hud, setHud] = useState<Hud | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const [a, c, h, g] = await Promise.all([
        fetch(`/api/hero-agents?department=${department}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ agents: [] })),
        fetch('/api/counts', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/hud', { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
        fetch('/api/goals', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({ goals: [] })),
      ]);
      if (cancel) return;
      setAgents(a.agents ?? []);
      setCounts(c);
      setHud(h);
      setGoals(Array.isArray(g?.goals) ? g.goals : []);
    };
    load();
    // 10s poll — the bar should reflect what the rest of the dashboard sees.
    const t = setInterval(load, 10_000);
    return () => { cancel = true; clearInterval(t); };
  }, [department]);

  // True active = status pill says so OR a heartbeat fired within the last 90s
  // (covers the moment between "start" beat and the agent_tasks row updating).
  const nowSec = Math.floor(Date.now() / 1000);
  const activeAgents = agents.filter((a) => {
    if (a.status === 'active' || a.status === 'reviewing') return true;
    if (a.heartbeat && (nowSec - a.heartbeat.ts) < 90 && a.heartbeat.kind !== 'errored' && a.heartbeat.kind !== 'finished') return true;
    return false;
  }).length;
  // Two opposite-pile metrics from /api/hud:
  //   in_flight         = running missions + running sub-agent tasks (their pile)
  //   approvals_pending = pending drafts                              (your pile)
  const inFlight = hud?.in_flight ?? 0;
  const missionsRunning = hud?.missions_running ?? 0;
  const subTasksRunning = hud?.tasks_running ?? 0;
  const approvalsNeeded = hud?.approvals_pending ?? counts?.total_pending ?? 0;

  // Goal progress = weighted by status across non-abandoned goals.
  // done counts 1, pending_verification 0.85, active 0.3 — same weighting we
  // already use on /goals so the headline number matches what the user sees there.
  let goalProgress: number | null = null;
  if (goals && goals.length > 0) {
    const live = goals.filter((g) => g.status !== 'abandoned');
    if (live.length > 0) {
      const score = live.reduce((acc, g) =>
        acc + (g.status === 'done' ? 1 : g.status === 'pending_verification' ? 0.85 : 0.3), 0);
      goalProgress = Math.round((score / live.length) * 100);
    }
  }

  // Graded system state derived from live signals — drives both the label
  // and the interactive pulse intensity on the status ring.
  //   busy      — at least one agent is mid-run (fresh heartbeat < 90s).
  //   watch     — stale approvals piling up.
  //   degraded  — recent agent errors. (heartbeat tier 2 emits 'errored'.)
  //   optimal   — quiet and clean.
  const erroredRecently = agents.some((a) => a.heartbeat?.kind === 'errored' && (nowSec - a.heartbeat.ts) < 600);
  const beatingNow = agents.some((a) => a.heartbeat && (nowSec - a.heartbeat.ts) < 90 && a.heartbeat.kind !== 'errored' && a.heartbeat.kind !== 'finished');
  const stale = (hud?.approvals_stale ?? 0) > 0;
  const systemState: SystemState =
    erroredRecently ? 'degraded' :
    stale            ? 'watch' :
    beatingNow       ? 'busy' :
                       'optimal';
  const meta = STATE_META[systemState];

  return (
    <div className="panel">
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 divide-y md:divide-y-0 md:divide-x divide-border/40">
        <Cell
          label="System Status"
          value={<span style={{ color: meta.color }}>{meta.label}</span>}
          caption={meta.caption}
          icon={<StatusPulse state={systemState} />}
        />
        <Cell
          label="Agents Active"
          value={<span style={{ color: activeAgents > 0 ? 'var(--primary)' : undefined }}>{activeAgents}</span>}
          caption={agents.length ? `Of ${agents.length} in this lens` : 'No agents in this lens'}
          icon={<Users size={18} className={activeAgents > 0 ? 'text-[var(--primary)]' : 'text-muted-foreground'} />}
        />
        <Cell
          label="In Flight"
          value={
            <span style={{ color: inFlight > 0 ? 'var(--info, #6aa9ff)' : undefined }}>
              {inFlight}
            </span>
          }
          caption={
            inFlight === 0
              ? 'Agents idle — brief them'
              : missionsRunning > 0
                ? `${missionsRunning} mission${missionsRunning === 1 ? '' : 's'} · ${subTasksRunning} sub-task${subTasksRunning === 1 ? '' : 's'}`
                : `${subTasksRunning} sub-task${subTasksRunning === 1 ? '' : 's'} running`
          }
          icon={
            <PlayCircle
              size={18}
              className={inFlight > 0 ? '' : 'text-muted-foreground'}
              style={inFlight > 0 ? { color: 'var(--info, #6aa9ff)' } : undefined}
            />
          }
          href="/tasks"
        />
        <Cell
          label="Approvals Needed"
          value={<span className={approvalsNeeded > 0 ? 'text-warning' : ''}>{approvalsNeeded}</span>}
          caption={approvalsNeeded > 0 ? 'Require your attention' : 'Inbox clear'}
          icon={<Inbox size={18} className={approvalsNeeded > 0 ? 'text-warning' : 'text-muted-foreground'} />}
          href="/drafts"
        />
        <Cell
          label="Goal Progress"
          value={
            <span style={{ color: goalProgress != null ? 'var(--primary)' : undefined }}>
              {goalProgress != null ? `${goalProgress}%` : '—'}
            </span>
          }
          caption={
            goalProgress == null ? 'No goals yet'
            : goalProgress >= 80 ? 'On track'
            : goalProgress >= 50 ? 'Making progress'
            : 'Behind — needs push'
          }
          icon={<TrendingUp size={18} className={goalProgress != null ? 'text-[var(--primary)]' : 'text-muted-foreground'} />}
          href="/goals"
        />
      </div>
    </div>
  );
}

function Cell({ label, value, caption, icon, ring, href }:
  { label: string; value: React.ReactNode; caption: string; icon?: React.ReactNode; ring?: boolean; href?: string }) {
  const body = (
    <div
      className="p-5 flex items-start justify-between gap-3 h-full"
      style={href ? { transition: 'background-color var(--t-popover) var(--ease-out)' } : undefined}
    >
      <div className="space-y-1">
        <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
        <div className="text-3xl font-semibold tracking-tight leading-none">{value}</div>
        <div className="text-[11px] text-muted-foreground">{caption}</div>
      </div>
      {ring ? <StatusPulse state="optimal" /> : <div className="mt-1 shrink-0">{icon}</div>}
    </div>
  );
  // Linked cells subtly highlight on hover so the affordance reads as "this is a button."
  if (href) {
    return (
      <Link href={href} className="block kpi-cell-link focus-ring" aria-label={`Open ${label}`}>
        {body}
      </Link>
    );
  }
  return body;
}

// System state vocabulary. Each state drives label, color, caption, and the
// pulse animation tempo on the StatusPulse ring.
type SystemState = 'optimal' | 'busy' | 'watch' | 'degraded';

const STATE_META: Record<SystemState, { label: string; caption: string; color: string }> = {
  optimal:  { label: 'Optimal',  caption: 'All core systems operational',     color: 'var(--primary)' },
  busy:     { label: 'Working',  caption: 'Agents currently running',          color: 'var(--info, #6aa9ff)' },
  watch:    { label: 'Watch',    caption: 'Stale approvals — needs attention', color: 'var(--warning)' },
  degraded: { label: 'Degraded', caption: 'Recent agent errors',               color: 'var(--destructive)' },
};

// Two concentric rings around a central dot, each ring breathing on its own
// duration. The state changes the color + tempo so a glance tells you "we're
// running" vs "we're stuck."
function StatusPulse({ state }: { state: SystemState }) {
  const m = STATE_META[state];
  // Busy = fastest tempo (energetic). Degraded = mid (insistent). Optimal/watch = slow (calm).
  const t1 = state === 'busy' ? '1.4s' : state === 'degraded' ? '1.8s' : '3s';
  const t2 = state === 'busy' ? '2s'   : state === 'degraded' ? '2.4s' : '4.5s';
  return (
    <div className="relative w-12 h-12 shrink-0" aria-label={`System ${m.label}`}>
      <span
        aria-hidden
        className="absolute inset-0 rounded-full"
        style={{
          border: `1px solid color-mix(in srgb, ${m.color} 35%, transparent)`,
          animation: `status-breathe ${t2} ease-in-out infinite`,
        }}
      />
      <span
        aria-hidden
        className="absolute inset-1.5 rounded-full"
        style={{
          border: `1px solid color-mix(in srgb, ${m.color} 60%, transparent)`,
          animation: `status-breathe ${t1} ease-in-out infinite`,
          animationDelay: '0.3s',
        }}
      />
      <div className="absolute inset-0 flex items-center justify-center">
        <Target size={18} style={{ color: m.color }} />
      </div>
    </div>
  );
}
