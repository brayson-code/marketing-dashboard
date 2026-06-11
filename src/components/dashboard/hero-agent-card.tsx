'use client';

import { AgentOrb, colorForDepartment, type Department } from '@/components/agent-orb';
import { MoreHorizontal, Star } from 'lucide-react';

interface HeroAgent {
  id: string; name: string; role_title: string; department: Department | null;
  description: string; status: 'active' | 'reviewing' | 'idle' | string;
  runs_7d: number;
  // Latest heartbeat (within the last 24h). Drives the "currently / Xs ago"
  // ticker line + freshness glow. Null when the agent hasn't beat lately.
  heartbeat?: { ts: number; kind: 'start' | 'progress' | 'finished' | 'errored' | 'tick'; message: string } | null;
  // The goal this agent is driving toward. Owner is set via goals.metadata.owner_agent.
  // Hero card uses it as the progress bar's label + real percent.
  goal?: {
    id: string; title: string; status: string; due: string | null;
    progress: number; is_north_star: boolean;
  } | null;
}

// The signature C-suite cards from the reference. Each card carries the
// department's color in its orb (top-right), status pill, and progress bar
// foot, so a glance tells you who's doing what.
export function HeroAgentCard({ agent }: { agent: HeroAgent }) {
  const c = colorForDepartment(agent.department ?? undefined);
  const statusMeta = STATUS_META[agent.status] ?? STATUS_META.idle;
  // Progress is the agent's owned goal — the bar means something concrete
  // ("how close are we to landing 25 partners") instead of a fake activity %.
  const goal = agent.goal ?? null;
  const progress = goal?.progress ?? 0;

  const beat = agent.heartbeat ?? null;
  const beatAgeSec = beat ? Math.max(0, Math.floor(Date.now() / 1000) - beat.ts) : null;
  // Freshness windows: <60s = bright (mid-run), <5min = dim (just wrapped),
  // older than that we don't display the ticker at all — it's stale signal.
  const beatFresh = beat && beatAgeSec != null && beatAgeSec < 60;
  const beatRecent = beat && beatAgeSec != null && beatAgeSec < 300;
  const isLive = agent.status === 'active' || agent.status === 'reviewing' || beatFresh;
  return (
    <div
      className={`panel relative overflow-hidden h-full ${isLive ? 'panel--sweep' : ''}`}
      data-live={isLive ? 'true' : undefined}
      style={isLive ? { ['--primary' as string]: c } : undefined}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: `radial-gradient(420px circle at 100% -20%, color-mix(in srgb, ${c} 22%, transparent), transparent 55%)` }}
      />
      {/* Compact layout: orb left, name + status stacked right, progress bar
          at the foot. ~70% shorter than the previous expanded card; reads
          well in a 5- or 6-up grid. */}
      <div className="relative p-3.5 h-full flex flex-col gap-2.5">
        <div className="flex items-center gap-2.5">
          <AgentOrb department={agent.department ?? undefined} size="md" />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-tight truncate">{agent.role_title}</div>
            <div className="text-[10px] text-muted-foreground truncate">{agent.name}</div>
          </div>
          <button className="p-0.5 text-muted-foreground hover:text-foreground shrink-0" aria-label="more"><MoreHorizontal size={13} /></button>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium"
            style={{ background: `color-mix(in srgb, ${statusMeta.color} 18%, transparent)`, color: statusMeta.color }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: statusMeta.color }} />
            {statusMeta.label}
          </span>
          {goal && <span className="text-[10px] font-mono text-muted-foreground">{progress}%</span>}
        </div>

        {goal && (
          <div className="flex items-start gap-1.5 min-w-0">
            {goal.is_north_star && (
              <Star size={10} className="text-[var(--primary)] mt-0.5 shrink-0 fill-[var(--primary)]" />
            )}
            <span className="text-[10px] text-muted-foreground truncate" title={goal.title}>
              <span className="opacity-70">Goal:</span> {goal.title}
            </span>
          </div>
        )}

        {beat && beatRecent && (
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              className={`w-1 h-1 rounded-full shrink-0 ${beatFresh ? 'pulse-dot' : ''}`}
              style={{ background: c, boxShadow: beatFresh ? `0 0 6px ${c}` : undefined, opacity: beatFresh ? 1 : 0.6 }}
            />
            <span className="text-[10px] text-muted-foreground truncate" title={beat.message}>
              {beatFresh ? 'now' : `${beatAgeSec! < 90 ? `${beatAgeSec}s` : `${Math.floor(beatAgeSec! / 60)}m`} ago`}
              {beat.message ? ` · ${beat.message}` : ''}
            </span>
          </div>
        )}

        {goal && (
          <div className="h-1 rounded-full overflow-hidden mt-auto" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${progress}%`, background: c, boxShadow: `0 0 10px ${c}` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_META: Record<string, { label: string; color: string }> = {
  active:    { label: 'Active',         color: 'var(--primary)' },
  reviewing: { label: 'Reviewing',      color: 'var(--dept-marketing)' },
  idle:      { label: 'Idle',           color: 'var(--muted-foreground)' },
  needs_approval: { label: 'Needs Approval', color: 'var(--warning)' },
};

function focusFor(a: HeroAgent): string {
  // Until we wire per-agent goals, surface something honest from the agent's
  // own definition instead of fabricating a focus line.
  if (/CMO|content|marketing/i.test(a.role_title)) return 'Brand & content';
  if (/CRO|outreach|sales|revenue/i.test(a.role_title)) return 'Pipeline & outreach';
  if (/COO|operations|ops|calendar/i.test(a.role_title)) return 'Operations';
  if (/CXO|client|customer/i.test(a.role_title)) return 'Client experience';
  if (/CEO|strategy|leadership/i.test(a.role_title)) return 'Strategy';
  return 'Recent activity';
}
