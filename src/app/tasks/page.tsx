'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, CheckCircle2, AlertCircle, Loader2, ArrowRight, Zap } from 'lucide-react';
import { Pipeline } from '@/components/tasks/pipeline';

type TaskView = 'activity' | 'pipeline';

type TaskStatus = 'running' | 'done' | 'error' | 'cancelled';

interface AgentTask {
  id: number;
  agent_id: string;
  parent_id: number | null;
  status: TaskStatus;
  task: string;
  result: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  stream_text: string | null;
  // Supabase returns timestamptz as ISO strings; tolerate legacy unix numbers too.
  started_at: string | number;
  completed_at: string | number | null;
}

interface TasksResponse {
  tasks: AgentTask[];
  counts: { running: number; total: number };
}

// Accepts ISO timestamp strings (Supabase) or unix-seconds numbers (legacy).
function toMs(ts: string | number): number {
  return typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
}

function formatTs(ts: string | number): string {
  const d = new Date(toMs(ts));
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function duration(t: AgentTask): string {
  const endMs = t.completed_at != null ? toMs(t.completed_at) : Date.now();
  const sec = Math.max(0, Math.floor((endMs - toMs(t.started_at)) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return `${m}m ${sec % 60}s`;
}

function StatusBadge({ status }: { status: TaskStatus }) {
  const config: Record<TaskStatus, { className: string; icon: typeof Activity; label: string }> = {
    running: { className: 'badge-info', icon: Loader2, label: 'running' },
    done: { className: 'badge-success', icon: CheckCircle2, label: 'done' },
    error: { className: 'badge-error', icon: AlertCircle, label: 'error' },
    cancelled: { className: 'badge-neutral', icon: AlertCircle, label: 'cancelled' },
  };
  const c = config[status];
  const Icon = c.icon;
  return (
    <span className={`badge ${c.className} inline-flex items-center gap-1`}>
      <Icon size={11} className={status === 'running' ? 'animate-spin' : ''} />
      {c.label}
    </span>
  );
}

export default function TasksPage() {
  const [data, setData] = useState<TasksResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [view, setView] = useState<TaskView>('pipeline');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/agent-tasks?limit=100', { cache: 'no-store' });
      const json = (await res.json()) as TasksResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [load]);

  const tasks = data?.tasks ?? [];
  const running = tasks.filter((t) => t.status === 'running');
  const recent = tasks.filter((t) => t.status !== 'running').slice(0, 50);

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function renderTask(t: AgentTask) {
    const isExpanded = expanded.has(t.id);
    const isChild = t.parent_id !== null;
    const totalTokens = (t.input_tokens ?? 0) + (t.output_tokens ?? 0);
    return (
      <div
        key={t.id}
        className={`panel cursor-pointer transition-smooth ${isChild ? 'ml-6 border-l-2 border-l-primary/40' : ''}`}
        onClick={() => toggle(t.id)}
      >
        <div className="p-3 space-y-1.5">
          <div className="flex items-center gap-2 text-xs flex-wrap">
            {isChild && <ArrowRight size={11} className="text-muted-foreground shrink-0" />}
            <span className="font-mono font-semibold text-foreground">{t.agent_id}</span>
            <StatusBadge status={t.status} />
            <span className="text-muted-foreground">{formatTs(t.started_at)}</span>
            <span className="text-muted-foreground">· {duration(t)}</span>
            {totalTokens > 0 && (
              <span className="text-muted-foreground">
                · {t.input_tokens} in / {t.output_tokens} out
              </span>
            )}
          </div>
          <div className="text-sm text-foreground line-clamp-2">{t.task}</div>
          {t.status === 'running' && t.stream_text && (
            <div
              className="mt-1 text-[11px] font-mono whitespace-pre-wrap bg-[var(--surface-2)] rounded p-2 max-h-48 overflow-y-auto border border-border/40"
              onClick={(e) => e.stopPropagation()}
            >
              {t.stream_text}
              <span className="inline-block w-1.5 h-3 ml-0.5 bg-primary/70 animate-pulse align-middle" />
            </div>
          )}
          {isExpanded && (
            <div className="pt-2 space-y-2 text-xs">
              <div>
                <div className="text-muted-foreground font-medium mb-1">Task</div>
                <div className="whitespace-pre-wrap text-foreground">{t.task}</div>
              </div>
              {t.result && (
                <div>
                  <div className="text-muted-foreground font-medium mb-1">Result</div>
                  <div className="whitespace-pre-wrap text-foreground bg-[var(--surface-2)] p-2 rounded">{t.result}</div>
                </div>
              )}
              {t.error && (
                <div>
                  <div className="text-destructive font-medium mb-1">Error</div>
                  <div className="whitespace-pre-wrap text-destructive bg-[var(--surface-2)] p-2 rounded">{t.error}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // Order: parents first, children indented under their parent
  function orderWithChildren(list: AgentTask[]): AgentTask[] {
    const byParent = new Map<number | null, AgentTask[]>();
    for (const t of list) {
      const key = t.parent_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(t);
    }
    const out: AgentTask[] = [];
    const roots = byParent.get(null) ?? [];
    for (const root of roots) {
      out.push(root);
      const kids = byParent.get(root.id);
      if (kids) out.push(...kids);
    }
    // Append any orphan children whose parent isn't in the slice
    const seen = new Set(out.map((t) => t.id));
    for (const t of list) if (!seen.has(t.id)) out.push(t);
    return out;
  }

  async function runProactive() {
    try {
      const res = await fetch('/api/triggers/run-proactive', { method: 'POST' });
      if (!res.ok) {
        const j = await res.json();
        setError(j.error || 'sweep failed');
      } else {
        setError(null);
      }
    } catch (err) { setError((err as Error).message); }
  }

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Tasks</h1>
          <p className="text-xs text-muted-foreground">
            {view === 'activity'
              ? 'Live view of orchestrator and sub-agent activity. Refreshes every 2s.'
              : 'How the orchestrator’s parallel agent waves flow toward each goal. Refreshes every 3s.'}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          <div className="flex gap-1">
            <button onClick={() => setView('activity')} className={`tab ${view === 'activity' ? 'active' : ''}`}>
              Activity
            </button>
            <button onClick={() => setView('pipeline')} className={`tab ${view === 'pipeline' ? 'active' : ''}`}>
              Pipeline
            </button>
          </div>
          {view === 'activity' && (
            <>
              <button onClick={runProactive} className="btn btn-ghost btn-sm" title="Trigger KeyPlayer to scan for stalled goals, pending drafts, long-running tasks, etc.">
                <Zap size={11} /> Run proactive sweep
              </button>
              <span className="badge badge-info inline-flex items-center gap-1.5">
                <Loader2 size={11} className={running.length > 0 ? 'animate-spin' : ''} />
                {running.length} running
              </span>
              <span className="badge badge-neutral">{data?.counts.total ?? 0} total</span>
            </>
          )}
        </div>
      </div>

      {error && view === 'activity' && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {view === 'pipeline' ? (
        <Pipeline />
      ) : (
        <>
          {running.length > 0 && (
            <div className="space-y-2">
              <div className="section-title">In progress</div>
              <div className="space-y-2">{orderWithChildren(running).map(renderTask)}</div>
            </div>
          )}

          <div className="space-y-2">
            <div className="section-title">Recent</div>
            {recent.length === 0 ? (
              <div className="panel p-4 text-xs text-muted-foreground text-center">
                No completed tasks yet. Send a message to KeyPlayer to kick one off.
              </div>
            ) : (
              <div className="space-y-2">{orderWithChildren(recent).map(renderTask)}</div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
