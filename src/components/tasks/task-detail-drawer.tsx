'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { X, Loader2, Send, Copy, Check, Clock, Coins, CornerUpRight } from 'lucide-react';
import { AgentOrb, type Department } from '@/components/agent-orb';
import { toast } from '@/components/ui/toast';

export interface DrawerTask {
  id: number; agent_id: string; task: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  started_at: string | number; completed_at: string | number | null;
  result?: string | null; error?: string | null; stream_text?: string | null;
  input_tokens?: number | null; output_tokens?: number | null;
}
export interface DrawerDraft { id: number; title: string; type: string; status: string }

function toMs(ts: string | number): number {
  return typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
}
function dur(t: DrawerTask): string {
  const end = t.completed_at != null ? toMs(t.completed_at) : Date.now();
  const s = Math.max(0, Math.floor((end - toMs(t.started_at)) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

// Slide-over panel for a single task/draft on the Tasks board — click a card to
// "work inside it": read the full instruction + live output, and dispatch a refined
// follow-up to the same agent without leaving the board.
export function TaskDetailDrawer({
  task, draft, agentLabel, department, onClose, onDispatched, onApprove, onReject,
}: {
  task: DrawerTask | null;
  draft: DrawerDraft | null;
  agentLabel: string;
  department?: Department;
  onClose: () => void;
  onDispatched: () => void;
  onApprove?: () => void;
  onReject?: () => void;
}) {
  const open = !!(task || draft);
  const [followUp, setFollowUp] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  // Seed the composer with the task instruction so you can refine + re-run, or clear
  // it for a fresh follow-up. Re-seed whenever a different task is opened.
  useEffect(() => { setFollowUp(task?.task ?? ''); }, [task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    if (open) window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (typeof document === 'undefined') return null;

  const output = task
    ? (task.status === 'running' ? (task.stream_text ?? '') : task.status === 'error' ? (task.error ?? '') : (task.result ?? ''))
    : '';

  async function dispatch() {
    if (!task || !followUp.trim() || busy) return;
    setBusy(true);
    try {
      const r = await fetch('/api/agent-tasks', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ agent_id: task.agent_id, task: followUp.trim() }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Dispatch failed');
      toast.success(`Sent to ${agentLabel} — watch the Doing column`);
      onDispatched();
      onClose();
    } catch (e) { toast.error((e as Error).message); }
    finally { setBusy(false); }
  }

  function copyOut() {
    navigator.clipboard?.writeText(output).then(() => {
      setCopied(true); window.setTimeout(() => setCopied(false), 1400);
    }).catch(() => {});
  }

  const tokens = task ? (task.input_tokens ?? 0) + (task.output_tokens ?? 0) : 0;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 z-[89]"
        style={{
          background: 'color-mix(in srgb, var(--background) 55%, transparent)',
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity var(--t-modal) var(--ease-out)',
        }}
      />
      {/* Panel */}
      <aside
        role="dialog"
        aria-label="Task detail"
        className="fixed top-0 right-0 bottom-0 z-[90] w-full max-w-[480px] bg-card border-l border-border flex flex-col"
        style={{
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform var(--t-modal) var(--ease-drawer)',
          boxShadow: '-12px 0 40px color-mix(in srgb, var(--foreground) 12%, transparent)',
        }}
      >
        {open && (task ? (
          <>
            {/* Header */}
            <div className="flex items-start gap-3 p-4 border-b border-border/60">
              <AgentOrb department={department} size="sm" pulse={task.status === 'running'} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{agentLabel}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{task.agent_id}</div>
              </div>
              <span className={`badge ${task.status === 'done' ? 'badge-success' : task.status === 'error' ? 'badge-error' : task.status === 'running' ? 'badge-info' : 'badge-neutral'} inline-flex items-center gap-1`}>
                {task.status === 'running' && <Loader2 size={10} className="animate-spin" />}{task.status}
              </span>
              <button onClick={onClose} className="btn btn-ghost btn-sm -mt-1 -mr-1" aria-label="Close"><X size={14} /></button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {/* Meta */}
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Clock size={11} /> {dur(task)}</span>
                {tokens > 0 && <span className="inline-flex items-center gap-1"><Coins size={11} /> {task.input_tokens ?? 0} in / {task.output_tokens ?? 0} out</span>}
              </div>

              {/* Instruction */}
              <div>
                <div className="section-title mb-1">Instruction</div>
                <div className="text-xs whitespace-pre-wrap bg-[var(--surface-2)] rounded-md p-2.5 leading-relaxed">{task.task}</div>
              </div>

              {/* Output / live stream */}
              {(output || task.status === 'running') && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <div className="section-title">{task.status === 'running' ? 'Live output' : task.status === 'error' ? 'Error' : 'Result'}</div>
                    {output && (
                      <button onClick={copyOut} className="btn btn-ghost btn-sm" aria-label="Copy output">
                        {copied ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    )}
                  </div>
                  <pre className={`text-[11px] whitespace-pre-wrap rounded-md p-2.5 leading-relaxed max-h-[40vh] overflow-y-auto border border-border/40 ${task.status === 'error' ? 'text-destructive' : ''}`}
                       style={{ background: 'var(--surface-2)' }}>
                    {output || '…'}
                    {task.status === 'running' && <span className="inline-block w-1.5 h-3 ml-0.5 bg-primary/70 animate-pulse align-middle" />}
                  </pre>
                </div>
              )}
            </div>

            {/* Composer — refine + re-run / follow up */}
            <div className="border-t border-border/60 p-3 space-y-2">
              <div className="section-title flex items-center gap-1.5"><CornerUpRight size={12} /> Work on it</div>
              <textarea
                className="w-full input text-sm"
                rows={3}
                value={followUp}
                onChange={(e) => setFollowUp(e.target.value)}
                placeholder={`Refine the instruction and re-run, or write a follow-up for ${agentLabel}…`}
              />
              <div className="flex justify-end">
                <button className="btn btn-primary btn-sm" disabled={busy || !followUp.trim()} onClick={dispatch}>
                  {busy ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Run with {agentLabel}
                </button>
              </div>
            </div>
          </>
        ) : draft ? (
          <>
            <div className="flex items-start gap-3 p-4 border-b border-border/60">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold truncate">{draft.title}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{draft.type} · {draft.status}</div>
              </div>
              <button onClick={onClose} className="btn btn-ghost btn-sm -mt-1 -mr-1" aria-label="Close"><X size={14} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              <p className="text-xs text-muted-foreground">This item is awaiting your review. Open it in Drafts to read the full content, or act on it here.</p>
              <Link href="/drafts" className="btn btn-ghost btn-sm">Open in Drafts →</Link>
            </div>
            {(onApprove || onReject) && draft.status === 'pending' && (
              <div className="border-t border-border/60 p-3 flex items-center gap-2">
                <button onClick={() => { onApprove?.(); onClose(); }} className="btn btn-success btn-sm flex-1"><Check size={12} /> Approve</button>
                <button onClick={() => { onReject?.(); onClose(); }} className="btn btn-ghost btn-sm"><X size={12} /> Reject</button>
              </div>
            )}
          </>
        ) : null)}
      </aside>
    </>,
    document.body,
  );
}
