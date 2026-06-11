'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Inbox, ChevronRight, Check, Send, CalendarCheck, Loader2, AlertTriangle, RotateCw, ExternalLink } from 'lucide-react';
import { AgentOrb, type Department } from '@/components/agent-orb';

type Sub = 'approvals' | 'retry';

interface Draft { id: number; type: string; title: string; status: string; created_at: string | number; metadata?: Record<string, unknown> }
interface AgentTask { id: number; agent_id: string; status: string; task: string; error?: string | null; started_at?: string | number }
interface Mission { id: string; title: string; status: string; current_wave?: number; total_waves?: number; updated_at?: string }

// The Overview's "what needs me" inbox. Two lanes, both backed by REAL,
// reliably-populated data (the old Handoffs/FYI tabs were dead for most tenants):
//   - Approvals — pending agent_drafts, with INLINE approve/publish so the
//                 queue does something the /drafts page can't (one-tap from
//                 the dashboard). This is the North-Star path: first_approval
//                 + first_publish both read agent_drafts.
//   - Needs Retry — errored agent_tasks + errored missions merged into one
//                 lane. The "something broke, re-kick it" signal. Empty on the
//                 happy path (fine for an exception lane); the high-value case
//                 is a failed FIRST mission silently blocking activation.
export function OperatorQueue({ department }: { department: Department }) {
  const [tab, setTab] = useState<Sub>('approvals');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [errTasks, setErrTasks] = useState<AgentTask[]>([]);
  const [errMissions, setErrMissions] = useState<Mission[]>([]);
  const [busy, setBusy] = useState<Record<number, 'approve' | 'publish' | null>>({});

  const load = useCallback(async () => {
    const [d, t, m] = await Promise.all([
      fetch('/api/drafts?status=pending', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/agent-tasks?limit=120', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
      fetch('/api/missions', { cache: 'no-store' }).then((r) => r.json()).catch(() => ({})),
    ]);
    setDrafts(Array.isArray(d) ? d : d.drafts ?? []);
    setErrTasks((Array.isArray(t?.tasks) ? t.tasks : []).filter((x: AgentTask) => x.status === 'error'));
    setErrMissions((Array.isArray(m?.missions) ? m.missions : []).filter((x: Mission) => x.status === 'error'));
  }, []);

  useEffect(() => {
    let cancel = false;
    const run = () => { if (!cancel) load(); };
    run();
    const id = setInterval(run, 15_000);
    return () => { cancel = true; clearInterval(id); };
  }, [load]);

  // Inline draft actions. "Approve" just approves; "Publish" approves THEN
  // executes by type (the activation-completing action). Both hit the existing
  // POST /api/drafts — no new endpoint. Optimistic: drop the row, then reconcile.
  const act = useCallback(async (draft: Draft, kind: 'approve' | 'publish') => {
    setBusy((b) => ({ ...b, [draft.id]: kind }));
    try {
      const approve = await fetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', draft_id: draft.id }),
      });
      if (!approve.ok) throw new Error('approve failed');
      if (kind === 'publish') {
        const exec = executeActionForType(draft.type);
        await fetch('/api/drafts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: exec, draft_id: draft.id }),
        });
      }
      // Optimistically remove from the pending list; poll will reconcile.
      setDrafts((ds) => ds.filter((x) => x.id !== draft.id));
    } catch {
      // leave the row; next poll restores accurate state
    } finally {
      setBusy((b) => ({ ...b, [draft.id]: null }));
    }
  }, []);

  const approvals = drafts.slice(0, 6);
  // Merge errored tasks + missions, newest-ish first (missions carry a wave cursor).
  const retryItems: Array<{ key: string; kind: 'task' | 'mission'; title: string; sub: string; href: string }> = [
    ...errMissions.map((m) => ({
      key: `m-${m.id}`, kind: 'mission' as const,
      title: m.title || 'Mission',
      sub: `mission failed${m.total_waves ? ` · wave ${(m.current_wave ?? 0) + 1}/${m.total_waves}` : ''}`,
      href: '/missions',
    })),
    ...errTasks.map((t) => ({
      key: `t-${t.id}`, kind: 'task' as const,
      title: t.task?.slice(0, 70) || `${t.agent_id} task`,
      sub: `${prettyAgent(t.agent_id)} errored${t.error ? ` · ${String(t.error).slice(0, 40)}` : ''}`,
      href: '/tasks',
    })),
  ].slice(0, 6);

  const counts: Record<Sub, number> = { approvals: drafts.length, retry: errMissions.length + errTasks.length };
  const total = counts.approvals + counts.retry;

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header items-start">
        <div className="flex items-center gap-2">
          <Inbox size={15} className="text-muted-foreground" />
          <h3 className="text-sm font-semibold">Operator Queue</h3>
          <span className="badge badge-neutral text-[10px]">{total}</span>
        </div>
      </div>

      <div className="px-4 pt-3 flex items-center gap-1">
        {(['approvals', 'retry'] as Sub[]).map((s) => {
          const active = tab === s;
          const danger = s === 'retry' && counts.retry > 0;
          const color = active ? (danger ? 'var(--destructive)' : 'var(--primary)') : 'var(--muted-foreground)';
          return (
            <button key={s} onClick={() => setTab(s)}
              className="px-3 py-1.5 rounded-md text-[11px] font-medium transition-colors inline-flex items-center gap-1"
              style={{
                background: active ? `color-mix(in srgb, ${danger ? 'var(--destructive)' : 'var(--primary)'} 14%, transparent)` : 'transparent',
                color,
              }}>
              {s === 'retry' && counts.retry > 0 && <AlertTriangle size={11} />}
              {s === 'approvals' ? 'Approvals' : 'Needs Retry'}
              <span className="opacity-60 ml-0.5">{counts[s]}</span>
            </button>
          );
        })}
      </div>

      <div className="panel-body space-y-1.5 flex-1 overflow-y-auto">
        {tab === 'approvals' && (approvals.length === 0 ? <Empty label="No pending approvals" /> :
          approvals.map((d) => (
            <ApprovalRow
              key={d.id}
              draft={d}
              department={department}
              busy={busy[d.id] ?? null}
              onApprove={() => act(d, 'approve')}
              onPublish={() => act(d, 'publish')}
            />
          ))
        )}

        {tab === 'retry' && (retryItems.length === 0 ? <Empty label="Nothing stuck — all clear" /> :
          retryItems.map((it) => (
            <div key={it.key} className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] transition-colors">
              <span className="w-6 h-6 rounded-full grid place-items-center shrink-0"
                style={{ background: 'color-mix(in srgb, var(--destructive) 16%, transparent)', color: 'var(--destructive)' }}>
                <AlertTriangle size={12} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{it.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{it.sub}</div>
              </div>
              <Link href={it.href} className="btn btn-ghost btn-sm shrink-0 inline-flex items-center gap-1">
                <RotateCw size={11} /> Open
              </Link>
            </div>
          ))
        )}
      </div>

      <div className="px-4 py-3 border-t border-border/40">
        <Link href={tab === 'retry' ? '/missions' : '/drafts'} className="inline-flex items-center gap-1 text-[11px] text-[var(--primary)] hover:underline">
          {tab === 'retry' ? 'Open missions' : 'View all drafts'} <ChevronRight size={11} />
        </Link>
      </div>
    </div>
  );
}

function ApprovalRow({ draft, department, busy, onApprove, onPublish }:
  { draft: Draft; department: Department; busy: 'approve' | 'publish' | null; onApprove: () => void; onPublish: () => void }) {
  const publishMeta = publishLabelForType(draft.type);
  return (
    <div className="flex items-center gap-2.5 p-2.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--surface-2)_70%,transparent)] transition-colors">
      <AgentOrb department={department} size="sm" pulse={false} />
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{draft.title}</div>
        <div className="text-[10px] text-muted-foreground truncate">{prettyType(draft.type)} · pending</div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={onApprove}
          disabled={!!busy}
          className="btn btn-ghost btn-sm inline-flex items-center gap-1"
          title="Approve (leaves it ready to execute on Drafts)"
        >
          {busy === 'approve' ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />} Approve
        </button>
        <button
          onClick={onPublish}
          disabled={!!busy}
          className="btn btn-primary btn-sm inline-flex items-center gap-1"
          title={`Approve & ${publishMeta.label.toLowerCase()} now`}
        >
          {busy === 'publish' ? <Loader2 size={11} className="animate-spin" /> : <publishMeta.Icon size={11} />} {publishMeta.label}
        </button>
      </div>
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return <div className="py-6 text-center text-[11px] text-muted-foreground">{label}</div>;
}

function prettyType(t: string): string {
  return { content_post: 'Social post', email: 'Email', meeting: 'Meeting', campaign: 'Campaign', other: 'Task' }[t] ?? t;
}

function prettyAgent(id: string): string {
  return (id || 'agent').replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Map draft type → the POST /api/drafts execute action.
function executeActionForType(type: string): 'publish' | 'send' | 'confirm' {
  if (type === 'email') return 'send';
  if (type === 'meeting') return 'confirm';
  return 'publish'; // content_post / campaign / other
}

// Label + icon for the primary execute button, by draft type.
function publishLabelForType(type: string): { label: string; Icon: typeof Send } {
  if (type === 'email') return { label: 'Send', Icon: Send };
  if (type === 'meeting') return { label: 'Confirm', Icon: CalendarCheck };
  return { label: 'Publish', Icon: ExternalLink };
}
