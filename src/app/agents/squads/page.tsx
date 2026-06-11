'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bot, Loader2, Cpu, Activity, Coins, Crown, Users } from 'lucide-react';
import Link from 'next/link';
import { type Department } from '@/components/agent-orb';
import { AgentIcon } from '@/components/agent-icon';

type Status = 'active' | 'idle' | 'error' | 'planned';

interface SquadAgent {
  id: string;
  name: string;
  emoji: string;
  role: string;
  model: string;
  description: string;
  department: string | null;
  is_executive: boolean;
  status: Status;
  stats: { runs: number; running: number; last_active: number | null; total_tokens: number; last_status: string | null };
}

// Map an agent's `role` to its department signature color. Replaces the
// emoji-as-identity pattern with the new AgentOrb visual language.
function deptForRole(role: string): Department {
  switch (role) {
    case 'orchestrator': return 'leadership';
    case 'content':
    case 'creative':     return 'marketing';
    case 'outreach':
    case 'research':     return 'revenue';
    case 'scheduler':
    case 'general':      return 'operations';
    default:             return 'operations';
  }
}

const STATUS_DOT: Record<Status, string> = {
  active: 'bg-success',
  idle: 'bg-warning',
  error: 'bg-destructive',
  planned: 'bg-muted-foreground/50',
};
const STATUS_LABEL: Record<Status, string> = {
  active: 'Active',
  idle: 'Idle',
  error: 'Error',
  planned: 'Not run yet',
};

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function ago(sec: number | null): string {
  if (!sec) return 'never';
  const s = Math.max(1, Math.floor(Date.now() / 1000 - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function SquadsPage() {
  const [agents, setAgents] = useState<SquadAgent[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/squad', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setAgents(Array.isArray(json.agents) ? json.agents : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const orchestrator = agents.find((a) => a.id === 'keyplayer');
  // "Org chart" = the executive layer (AI CEO + the rest of the C-suite). The
  // orchestrator sits above this row as its own highlight card.
  const orgChart = agents
    .filter((a) => a.is_executive && a.id !== 'keyplayer')
    .sort((a, b) => (a.id === 'ai-ceo' ? -1 : b.id === 'ai-ceo' ? 1 : a.name.localeCompare(b.name)));
  // "Specialists" = everyone else — the workers each exec dispatches.
  const specialists = agents.filter((a) => !a.is_executive && a.id !== 'keyplayer');
  const activeCount = agents.filter((a) => a.status === 'active').length;

  return (
    <div className="space-y-6 animate-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-h1 flex items-center gap-2"><Bot size={18} className="text-primary" /> Agents</h1>
          <p className="text-small">Click any agent to open its memory, learning, and active tasks.</p>
        </div>
        <span className="badge badge-neutral">{agents.length} agents · {activeCount} active</span>
      </div>

      {loading && agents.length === 0 ? (
        <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={14} className="animate-spin" /> Loading squad…
        </div>
      ) : (
        <>
          {orchestrator && <AgentCard agent={orchestrator} highlight />}

          {orgChart.length > 0 && (
            <section className="space-y-3">
              <SectionHeader icon={<Crown size={14} className="text-[var(--dept-leadership)]" />} title="Org chart" count={orgChart.length} subtitle="The executive layer — strategy, oversight, and audit." />
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {orgChart.map((a) => <AgentCard key={a.id} agent={a} />)}
              </div>
            </section>
          )}

          {specialists.length > 0 && (
            <section className="space-y-3">
              <SectionHeader icon={<Users size={14} className="text-primary" />} title="Specialists" count={specialists.length} subtitle="The workers — each does one thing well." />
              <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                {specialists.map((a) => <AgentCard key={a.id} agent={a} />)}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// Small repeating section header for the two roster groups.
function SectionHeader({ icon, title, count, subtitle }: { icon: React.ReactNode; title: string; count: number; subtitle: string }) {
  return (
    <div className="flex items-end justify-between gap-3">
      <div>
        <h2 className="text-h2 flex items-center gap-2">{icon} {title}</h2>
        <p className="text-micro text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <span className="badge badge-neutral">{count}</span>
    </div>
  );
}

function AgentCard({ agent, highlight }: { agent: SquadAgent; highlight?: boolean }) {
  return (
    <Link
      href={`/agents/${agent.id}`}
      className={`panel block card-hover ${highlight ? 'border-primary/40' : ''}`}
      style={highlight ? { boxShadow: '0 0 0 1px rgba(217,119,87,0.18) inset' } : undefined}
    >
      <div className="panel-body space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 shrink-0"><AgentIcon id={agent.id} role={agent.role} department={deptForRole(agent.role)} size="md" pulse={agent.status === 'active'} /></div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold truncate">{agent.name}</h3>
              <span className="badge badge-neutral text-[10px]">{agent.role}</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[agent.status]}`} />
              {STATUS_LABEL[agent.status]}
              {agent.stats.running > 0 && <span className="text-success">· {agent.stats.running} running</span>}
            </div>
          </div>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{agent.description}</p>

        <div className="flex items-center gap-3 text-[11px] text-muted-foreground border-t border-border/40 pt-2 flex-wrap">
          <span className="inline-flex items-center gap-1" title="Model"><Cpu size={11} /> {agent.model.replace('claude-', '')}</span>
          <span className="inline-flex items-center gap-1" title="Total runs"><Activity size={11} /> {agent.stats.runs} runs</span>
          <span className="inline-flex items-center gap-1" title="Total tokens"><Coins size={11} /> {fmtNum(agent.stats.total_tokens)}</span>
          <span className="ml-auto">{ago(agent.stats.last_active)}</span>
        </div>
      </div>
    </Link>
  );
}
