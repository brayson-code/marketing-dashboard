'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { Loader2, AlertCircle, CheckCircle2, Inbox, Activity, Sparkles, Check, X } from 'lucide-react';
import Link from 'next/link';
import { AgentOrb, type Department } from '@/components/agent-orb';
import { TaskDetailDrawer } from '@/components/tasks/task-detail-drawer';

// Real-time kanban for the Tasks page. Four columns, four states the operator
// actually cares about:
//
//   Up Next  — drafts pending your approval (YOUR move). These are the only
//              items that block execution until someone clicks Approve.
//   Doing    — agent_tasks currently running (the agents are working).
//   Done     — completed in the last 24h: agent_tasks 'done' + drafts that
//              executed (published / sent / confirmed). Recent-wins window.
//   Stuck    — agent_tasks 'error' + drafts rejected/expired.
//
// Polls /api/agent-tasks + /api/drafts every 3 seconds. Cards have unique keys,
// so when one moves between columns React mounts it fresh in the new column and
// it fade-ins via `data-stagger` — you actually SEE work flowing across the board.

type TaskStatus = 'running' | 'done' | 'error' | 'cancelled';
type DraftStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'sent' | 'confirmed' | 'expired';

interface AgentTask {
  id: number; agent_id: string; task: string; status: TaskStatus;
  started_at: string | number; completed_at: string | number | null;
  error?: string | null;
  result?: string | null; stream_text?: string | null;
  input_tokens?: number | null; output_tokens?: number | null;
}
interface Draft {
  id: number; type: string; title: string; status: DraftStatus;
  created_at: string | number;
  metadata?: { gated_decision?: string; autonomy_level?: string } | null;
}
interface AgentLite { id: string; name?: string; department?: Department | null; role_title?: string | null }

const POLL_MS = 3000;
const RECENT_MS = 24 * 60 * 60 * 1000;

interface Card {
  key: string;
  kind: 'task' | 'draft';
  column: 'todo' | 'doing' | 'done' | 'stuck';
  title: string;
  agent_id: string;
  agent_label: string;
  age_ms: number;
  status_label: string;
  draft_id?: number;
  task_id?: number;
}

function toMs(ts: string | number): number {
  return typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
}

function ago(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const COLUMNS = [
  { id: 'todo'  as const, label: 'Up Next',   accent: 'var(--warning)',           icon: Inbox,        sub: 'awaits your approval' },
  { id: 'doing' as const, label: 'Doing',     accent: 'var(--info)',              icon: Activity,     sub: 'agents working' },
  { id: 'done'  as const, label: 'Done',      accent: 'var(--primary)',           icon: CheckCircle2, sub: 'recent wins (24h)' },
  { id: 'stuck' as const, label: 'Stuck',     accent: 'var(--destructive)',       icon: AlertCircle,  sub: 'needs you' },
];

export function KanbanBoard() {
  const [tasks, setTasks] = useState<AgentTask[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [agents, setAgents] = useState<AgentLite[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [selected, setSelected] = useState<{ kind: 'task' | 'draft'; id: number } | null>(null);
  const liveRef = useRef(true);

  // Initial agents fetch (slow-changing, used to color orbs by department).
  useEffect(() => {
    fetch('/api/agents').then((r) => r.json()).then((j) => {
      const list = Array.isArray(j) ? j : (j.agents ?? []);
      setAgents(list as AgentLite[]);
    }).catch(() => {});
    // Also fetch the hero-agents endpoint to fill in department from agent_defs.
    fetch('/api/hero-agents?department=leadership').then((r) => r.json()).then((j) => {
      const more: AgentLite[] = (j.agents ?? []).map((a: { id: string; name: string; department: string; role_title: string }) =>
        ({ id: a.id, name: a.name, department: a.department as Department, role_title: a.role_title }));
      setAgents((prev) => mergeAgents(prev, more));
    }).catch(() => {});
  }, []);

  // Polling loop — tasks + drafts every 3s.
  useEffect(() => {
    let cancel = false;
    const tick = async () => {
      try {
        const [t, d] = await Promise.all([
          fetch('/api/agent-tasks?limit=100').then((r) => r.ok ? r.json() : { tasks: [] }),
          fetch('/api/drafts').then((r) => r.ok ? r.json() : { drafts: [] }),
        ]);
        if (cancel) return;
        setTasks((t.tasks ?? []) as AgentTask[]);
        setDrafts(((Array.isArray(d) ? d : d.drafts) ?? []) as Draft[]);
      } catch { /* keep last data */ }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => { cancel = true; clearInterval(id); liveRef.current = false; };
  }, []);

  const agentMap = useMemo(() => {
    const m = new Map<string, AgentLite>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  // Build cards from tasks + drafts and assign each to a column.
  const cards = useMemo<Card[]>(() => {
    const now = Date.now();
    const out: Card[] = [];

    for (const t of tasks) {
      const startMs = toMs(t.started_at);
      const a = agentMap.get(t.agent_id);
      const agentLabel = a?.role_title ?? a?.name ?? t.agent_id;
      if (t.status === 'running') {
        out.push({ key: `task-${t.id}`, kind: 'task', column: 'doing', title: t.task, agent_id: t.agent_id, agent_label: agentLabel, age_ms: now - startMs, status_label: 'running', task_id: t.id });
      } else if (t.status === 'done') {
        const endMs = t.completed_at ? toMs(t.completed_at) : startMs;
        if (now - endMs <= RECENT_MS) {
          out.push({ key: `task-${t.id}`, kind: 'task', column: 'done', title: t.task, agent_id: t.agent_id, agent_label: agentLabel, age_ms: now - endMs, status_label: 'done', task_id: t.id });
        }
      } else if (t.status === 'error') {
        out.push({ key: `task-${t.id}`, kind: 'task', column: 'stuck', title: t.task, agent_id: t.agent_id, agent_label: agentLabel, age_ms: now - startMs, status_label: 'error', task_id: t.id });
      }
    }

    for (const d of drafts) {
      const createdMs = toMs(d.created_at);
      const agentLabel = prettyType(d.type);
      if (d.status === 'pending') {
        out.push({ key: `draft-${d.id}`, kind: 'draft', column: 'todo', title: d.title, agent_id: 'keyplayer', agent_label: agentLabel, age_ms: Date.now() - createdMs, status_label: 'awaiting you', draft_id: d.id });
      } else if (d.status === 'published' || d.status === 'sent' || d.status === 'confirmed') {
        if (Date.now() - createdMs <= RECENT_MS) {
          out.push({ key: `draft-${d.id}`, kind: 'draft', column: 'done', title: d.title, agent_id: 'keyplayer', agent_label: agentLabel, age_ms: Date.now() - createdMs, status_label: d.status, draft_id: d.id });
        }
      } else if (d.status === 'rejected' || d.status === 'expired') {
        out.push({ key: `draft-${d.id}`, kind: 'draft', column: 'stuck', title: d.title, agent_id: 'keyplayer', agent_label: agentLabel, age_ms: Date.now() - createdMs, status_label: d.status, draft_id: d.id });
      }
    }
    return out.sort((a, b) => a.age_ms - b.age_ms);
  }, [tasks, drafts, agentMap]);

  const byColumn = useMemo(() => {
    const m: Record<Card['column'], Card[]> = { todo: [], doing: [], done: [], stuck: [] };
    for (const c of cards) m[c.column].push(c);
    return m;
  }, [cards]);

  async function actOnDraft(id: number, action: 'approve' | 'reject') {
    setBusy(id);
    try {
      await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, draft_id: id }) });
    } finally { setBusy(null); }
  }

  // Live-resolve the open item from polled state, so a running task's drawer keeps
  // streaming as the 3s poll refreshes.
  const selTask = selected?.kind === 'task' ? tasks.find((t) => t.id === selected.id) ?? null : null;
  const selDraft = selected?.kind === 'draft' ? drafts.find((d) => d.id === selected.id) ?? null : null;
  const selAgent = selTask ? agentMap.get(selTask.agent_id) : undefined;
  const selLabel = selTask
    ? (selAgent?.role_title ?? selAgent?.name ?? selTask.agent_id)
    : (selDraft ? prettyType(selDraft.type) : '');

  return (
    <>
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
      {COLUMNS.map((col) => {
        const Icon = col.icon;
        const items = byColumn[col.id];
        return (
          <div key={col.id} className="panel flex flex-col min-h-[60vh] max-h-[78vh]">
            <div className="px-4 py-3 border-b border-border/40 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Icon size={14} style={{ color: col.accent }} />
                <span className="text-h2">{col.label}</span>
                <span
                  className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                  style={{ background: `color-mix(in srgb, ${col.accent} 18%, transparent)`, color: col.accent }}
                >{items.length}</span>
              </div>
              <span className="text-micro text-muted-foreground hidden lg:inline">{col.sub}</span>
            </div>
            <div className="p-3 space-y-2 overflow-y-auto flex-1" data-stagger>
              {items.length === 0 ? (
                <ColumnEmpty label={col.label} />
              ) : (
                items.map((c) => (
                  <KanbanCard
                    key={c.key}
                    card={c}
                    agent={agentMap.get(c.agent_id)}
                    onApprove={c.draft_id ? () => actOnDraft(c.draft_id!, 'approve') : undefined}
                    onReject={c.draft_id ? () => actOnDraft(c.draft_id!, 'reject') : undefined}
                    onOpen={() => setSelected({ kind: c.kind, id: (c.task_id ?? c.draft_id)! })}
                    busy={c.draft_id === busy}
                    accent={col.accent}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
    <TaskDetailDrawer
      task={selTask}
      draft={selDraft}
      agentLabel={selLabel}
      department={selAgent?.department ?? undefined}
      onClose={() => setSelected(null)}
      onDispatched={() => { /* the 3s poll refreshes the board */ }}
      onApprove={selDraft ? () => actOnDraft(selDraft.id, 'approve') : undefined}
      onReject={selDraft ? () => actOnDraft(selDraft.id, 'reject') : undefined}
    />
    </>
  );
}

function KanbanCard({ card, agent, onApprove, onReject, onOpen, busy, accent }:
  { card: Card; agent?: AgentLite; onApprove?: () => void; onReject?: () => void; onOpen: () => void; busy: boolean; accent: string }) {
  const dept = agent?.department ?? undefined;
  const isRunning = card.column === 'doing';
  return (
    <div
      onClick={onOpen}
      className={`rounded-lg border p-3 space-y-2 bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] cursor-pointer hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] ${isRunning ? 'panel--sweep' : ''}`}
      data-live={isRunning ? 'true' : undefined}
      style={{
        borderColor: 'color-mix(in srgb, var(--border) 80%, transparent)',
        transition: 'border-color var(--t-press) var(--ease-out), box-shadow var(--t-press) var(--ease-out)',
        ...(isRunning ? { ['--primary' as string]: accent } : {}),
      }}
    >
      <div className="flex items-start gap-2.5">
        <AgentOrb department={dept} size="sm" pulse={isRunning} />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium leading-snug line-clamp-2">{card.title}</div>
          <div className="text-micro text-muted-foreground mt-0.5 flex items-center gap-1.5">
            <span className="truncate">{card.agent_label}</span>
            <span>·</span>
            <span className="font-mono">{ago(card.age_ms)}</span>
          </div>
        </div>
      </div>
      {card.draft_id && card.column === 'todo' && (
        <div className="flex items-center gap-1.5 pt-1 border-t border-border/40">
          <button onClick={(e) => { e.stopPropagation(); onApprove?.(); }} disabled={busy} className="btn btn-success btn-sm flex-1">
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve
          </button>
          <button onClick={(e) => { e.stopPropagation(); onReject?.(); }} disabled={busy} className="btn btn-ghost btn-sm">
            <X size={11} />
          </button>
        </div>
      )}
      {card.draft_id && card.column !== 'todo' && (
        <Link href={`/drafts`} onClick={(e) => e.stopPropagation()} className="block text-micro text-muted-foreground hover:text-foreground">View draft →</Link>
      )}
    </div>
  );
}

function ColumnEmpty({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-10 gap-2 text-muted-foreground">
      <Sparkles size={18} className="opacity-40" />
      <span className="text-micro">Nothing in {label.toLowerCase()}.</span>
    </div>
  );
}

function prettyType(t: string): string {
  return { content_post: 'Social post', email: 'Outreach email', meeting: 'Meeting confirm', campaign: 'Campaign', other: 'Task' }[t] ?? t;
}

function mergeAgents(a: AgentLite[], b: AgentLite[]): AgentLite[] {
  const map = new Map<string, AgentLite>();
  for (const x of a) map.set(x.id, x);
  for (const x of b) map.set(x.id, { ...(map.get(x.id) ?? {}), ...x });
  return Array.from(map.values());
}
