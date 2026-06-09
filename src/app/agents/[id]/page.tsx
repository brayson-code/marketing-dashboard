'use client';

import { use, useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ChevronDown, Loader2, Brain, GraduationCap, Activity, Radio, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { TechnicalDetails, TechRow } from '@/components/ui/technical-details';
import { AgentIcon } from '@/components/agent-icon';
import type { Department } from '@/components/agent-orb';

interface AgentDef {
  id: string; name: string; role: string; role_title: string | null;
  department: string | null; description: string; model: string;
  pulse?: string; pulse_updated_at?: number;
}
interface MemoryTask {
  id: number; status: string; task: string; result: string | null; error: string | null;
  input_tokens: number | null; output_tokens: number | null;
  started_at_epoch: number; completed_at_epoch: number | null;
}
interface Heartbeat {
  ts: number;
  kind: 'start' | 'progress' | 'finished' | 'errored' | 'tick';
  message: string;
  task_id: number | null;
}
interface MemoryPayload {
  agent: AgentDef;
  totals: { runs: number; done: number; errors: number; tokens: number };
  tasks: MemoryTask[];
  heartbeats?: Heartbeat[];
  editable?: boolean;
}

type Tab = 'memory' | 'learning' | 'tasks';

export default function AgentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [tab, setTab] = useState<Tab>('memory');
  const [data, setData] = useState<MemoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch(`/api/agents/${id}/memory`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (!cancel) { if (j.error) setError(j.error); else setData(j); } })
      .catch((e) => { if (!cancel) setError((e as Error).message); });
    return () => { cancel = true; };
  }, [id]);

  if (error) {
    return (
      <div className="space-y-5 animate-in">
        <BackLink />
        <div className="panel p-6 text-small text-destructive">Could not load agent — {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="space-y-5 animate-in">
        <BackLink />
        <div className="panel p-8 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading agent…
        </div>
      </div>
    );
  }

  const a = data.agent;
  const dept = (a.department as Department | null) ?? null;
  const displayName = a.role_title ?? a.name;

  return (
    <div className="space-y-5 animate-in">
      <BackLink />

      <PageHeader
        icon={<AgentIcon id={a.id} role={a.role} department={dept} size="md" pulse />}
        title={displayName}
        subtitle={`${a.name} · ${a.description}`}
        actions={
          <>
            {data.editable && (
              <Link
                href={`/agents/workspace?agent=${encodeURIComponent(a.id)}`}
                className="btn btn-sm text-xs"
                title="Edit this agent’s soul / agent / skills in Agent Studio"
              >
                <Pencil size={13} /> Edit
              </Link>
            )}
            <span className="badge badge-neutral">{data.totals.runs} runs</span>
          </>
        }
      />

      <div className="panel p-1.5 flex items-center gap-1 overflow-x-auto">
        <TabButton id="memory"   active={tab === 'memory'}   onClick={() => setTab('memory')}   icon={<Brain size={14} />}        label="Memory"   count={data.totals.runs} />
        <TabButton id="learning" active={tab === 'learning'} onClick={() => setTab('learning')} icon={<GraduationCap size={14} />} label="Learning" count={0} />
        <TabButton id="tasks"    active={tab === 'tasks'}    onClick={() => setTab('tasks')}    icon={<Activity size={14} />}     label="Tasks"    count={data.tasks.filter(t => t.status === 'running').length} />
      </div>

      {tab === 'memory'   && <MemoryTab data={data} />}
      {tab === 'learning' && <LearningTab />}
      {tab === 'tasks'    && <TasksTab data={data} />}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/agents/squads" className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
      <ArrowLeft size={12} /> Back to agents
    </Link>
  );
}

function TabButton({ active, onClick, icon, label, count }:
  { id: string; active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count: number }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 min-w-[120px] flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
      style={{
        background: active ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent',
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        transition: 'background-color var(--t-popover) var(--ease-out), color var(--t-popover) var(--ease-out)',
      }}
    >
      {icon}
      <span>{label}</span>
      {count > 0 && <span className="badge badge-neutral text-[9px]">{count}</span>}
    </button>
  );
}

// ─── Memory tab ──────────────────────────────────────────────────────────────
// Today's memory = a chronological tail of completed work + token totals. When
// per-agent memory.md rollups exist in the DB, they'll prepend as a "rolling
// summary" here above the timeline.
function MemoryTab({ data }: { data: MemoryPayload }) {
  const pulse = (data.agent.pulse ?? '').trim();
  return (
    <div className="space-y-5">
      {/* Pulse — the agent's rolling state. Headline above the timeline. */}
      <div className="panel relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(420px circle at 100% -20%, color-mix(in srgb, var(--primary) 16%, transparent), transparent 55%)' }}
        />
        <div className="relative p-5 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] pulse-dot" />
            <h3 className="text-h2">Status</h3>
            <span className="text-micro text-muted-foreground">what it&rsquo;s focused on right now</span>
          </div>
          {pulse ? (
            <pre className="text-xs leading-relaxed whitespace-pre-wrap font-sans text-foreground/90">{pulse}</pre>
          ) : (
            <p className="text-small">No pulse written yet — this agent updates it at the end of each successful run.</p>
          )}
        </div>
      </div>

      <HeartbeatTape beats={data.heartbeats ?? []} />

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total runs"  value={data.totals.runs.toLocaleString()} />
        <Stat label="Completed"   value={data.totals.done.toLocaleString()} accent="var(--primary)" />
        <Stat label="Errors"      value={data.totals.errors.toLocaleString()} accent={data.totals.errors > 0 ? 'var(--destructive)' : undefined} />
      </div>

      <RecentMemory tasks={data.tasks} />

      {/* Raw internals tucked away for operators; engineers can expand. */}
      <TechnicalDetails storageKey="agentDetail.tech.open">
        <TechRow label="Model" value={data.agent.model} />
        <TechRow label="Tokens used" value={`${fmt(data.totals.tokens)} across ${data.totals.runs} runs`} />
        <TechRow label="Agent ID" value={data.agent.id} />
      </TechnicalDetails>
    </div>
  );
}

// Collapsible Recent-memory panel. Default open when there's a small trail
// (≤6), default closed otherwise so the page lands compact. State persists
// per-agent in localStorage so it remembers your preference across reloads.
function RecentMemory({ tasks }: { tasks: MemoryTask[] }) {
  // Stable storage key — the agent id is implicit from the page route, but the
  // tasks array gives us a tenant-scoped fingerprint without prop drilling.
  const storageKey = 'agentDetail.recentMemory.open';
  const defaultOpen = tasks.length > 0 && tasks.length <= 6;
  const [open, setOpen] = useState<boolean>(defaultOpen);

  // Read persisted preference once on mount (skip during SSR).
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === '1') setOpen(true);
      else if (raw === '0') setOpen(false);
    } catch { /* localStorage blocked — fine, default stays */ }
  }, []);

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* blocked */ }
      return next;
    });
  };

  const count = Math.min(tasks.length, 50);
  return (
    <div className="panel">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full panel-header flex items-center gap-2 text-left"
        style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
      >
        <ChevronDown
          size={14}
          className="text-muted-foreground shrink-0"
          style={{ transform: open ? 'rotate(0deg)' : 'rotate(-90deg)', transition: 'transform var(--t-popover) var(--ease-out)' }}
        />
        <h3 className="text-h2">Recent memory</h3>
        <span className="text-small ml-auto">
          {tasks.length === 0 ? 'nothing yet' : `last ${count} run${count === 1 ? '' : 's'}`}
        </span>
      </button>
      {open && (
        <div className="panel-body space-y-2">
          {tasks.length === 0 ? (
            <div className="py-10 text-center text-small">
              No memory yet. The moment this agent runs, you&apos;ll see its trail here.
            </div>
          ) : (
            tasks.map((t) => <MemoryRow key={t.id} t={t} />)
          )}
        </div>
      )}
    </div>
  );
}

function MemoryRow({ t }: { t: MemoryTask }) {
  const [open, setOpen] = useState(false);
  const tokens = (t.input_tokens ?? 0) + (t.output_tokens ?? 0);
  const dur =
    t.completed_at_epoch != null
      ? `${Math.max(1, t.completed_at_epoch - t.started_at_epoch)}s`
      : '…';
  const summary = (t.result ?? t.error ?? '').slice(0, 180);

  return (
    <div className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left p-3 flex items-start gap-3"
      >
        <StatusDot status={t.status} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium line-clamp-1">{t.task}</div>
          <div className="text-micro mt-0.5 flex items-center gap-2 flex-wrap">
            <span>{new Date(t.started_at_epoch * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            <span>·</span>
            <span className="font-mono">{dur}</span>
            {tokens > 0 && <><span>·</span><span className="font-mono">{fmt(tokens)} tok</span></>}
          </div>
        </div>
        {summary && (
          <ChevronDown
            size={13}
            className="text-muted-foreground shrink-0 mt-0.5"
            style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--t-press) var(--ease-out)' }}
          />
        )}
      </button>
      {open && summary && (
        <div className="px-3 pb-3 -mt-1 text-[11px] text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-12">
          {t.result ?? t.error}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'done' ? 'var(--primary)' :
    status === 'running' ? 'var(--info)' :
    status === 'error' ? 'var(--destructive)' : 'var(--muted-foreground)';
  return <span className="mt-1.5 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />;
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-lg p-3 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
      <div className="text-micro text-muted-foreground">{label}</div>
      <div className="text-h2 mt-0.5" style={accent ? { color: accent } : undefined}>{value}</div>
    </div>
  );
}

// ─── Learning tab (placeholder until per-agent learnings land in DB) ─────────
function LearningTab() {
  return (
    <div className="panel py-12 text-center text-small flex flex-col items-center gap-2">
      <GraduationCap size={24} className="opacity-40" />
      <div className="text-h2">Learning view coming next</div>
      <p className="max-w-sm">Per-agent learnings (what it figured out across runs, ranked by impact) will appear here once we wire the learnings table.</p>
    </div>
  );
}

// ─── Tasks tab — running + pending work for this agent ──────────────────────
function TasksTab({ data }: { data: MemoryPayload }) {
  const open = data.tasks.filter((t) => t.status === 'running');
  return (
    <div className="space-y-3">
      <div className="panel">
        <div className="panel-header">
          <h3 className="text-h2">Currently running</h3>
        </div>
        <div className="panel-body space-y-2">
          {open.length === 0 ? (
            <div className="py-6 text-center text-small">Nothing running for this agent right now.</div>
          ) : (
            open.map((t) => <MemoryRow key={t.id} t={t} />)
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Heartbeat tape ─────────────────────────────────────────────────────────
// Real-time presence strip. One row per beat, newest first. Renders nothing
// when the agent has never beat — the table is brand-new and most agents
// haven't run since it landed. Once they do, this becomes the "what is it
// doing right now" view sandwiched between Pulse (between runs) and the
// timeline of completed work below.
function HeartbeatTape({ beats }: { beats: Heartbeat[] }) {
  if (!beats || beats.length === 0) return null;
  const nowSec = Math.floor(Date.now() / 1000);
  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Radio size={13} className="text-[var(--primary)]" />
        <h3 className="text-h2">Activity</h3>
        <span className="text-small">last {beats.length} update{beats.length === 1 ? '' : 's'}</span>
      </div>
      <div className="panel-body space-y-1.5">
        {beats.map((b, i) => {
          const age = Math.max(0, nowSec - b.ts);
          const ageLabel = age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;
          const meta = BEAT_META[b.kind];
          return (
            <div key={i} className="flex items-start gap-2 text-[11px]">
              <span className="mt-1 w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }} />
              <span className="font-mono text-muted-foreground w-10 shrink-0">{ageLabel}</span>
              <span className="font-medium shrink-0" style={{ color: meta.color }}>{meta.label}</span>
              {b.message && <span className="text-muted-foreground truncate">{b.message}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const BEAT_META: Record<Heartbeat['kind'], { label: string; color: string }> = {
  start:    { label: 'started',  color: 'var(--info)' },
  progress: { label: 'progress', color: 'var(--primary)' },
  finished: { label: 'finished', color: 'var(--primary)' },
  errored:  { label: 'errored',  color: 'var(--destructive)' },
  tick:     { label: 'tick',     color: 'var(--muted-foreground)' },
};

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
