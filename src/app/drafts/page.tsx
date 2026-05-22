'use client';

import { useCallback, useEffect, useState } from 'react';
import { Inbox, FileText, Mail, Calendar, Megaphone, Check, X, AlertCircle, Send, CheckCircle2, ScanSearch, Loader2, Sparkles } from 'lucide-react';

type DraftType = 'content_post' | 'email' | 'meeting' | 'campaign' | 'other';
type DraftStatus = 'pending' | 'approved' | 'rejected' | 'published' | 'sent' | 'confirmed' | 'expired';

interface DraftRevalidation {
  still_needed: 'yes' | 'no' | 'unclear';
  superseded: boolean;
  rationale: string;
  checked_files: string[];
  at: string;
}

interface Draft {
  id: number;
  type: DraftType;
  title: string;
  payload: string;
  status: DraftStatus;
  created_by: string | null;
  // Supabase returns timestamptz as ISO strings; tolerate legacy unix numbers too.
  created_at: string | number;
  reviewed_at: string | number | null;
  executed_at: string | number | null;
  execution_note: string | null;
  revalidated_at: string | number | null;
  revalidation: DraftRevalidation | null;
}

// A draft the triager judged no-longer-needed or already covered.
function isFlagged(d: Draft): boolean {
  return !!d.revalidation && (d.revalidation.still_needed === 'no' || d.revalidation.superseded);
}

const TYPE_META: Record<DraftType, { icon: typeof FileText; label: string; executeAction: 'publish' | 'send' | 'confirm' | null; executeLabel: string }> = {
  content_post: { icon: FileText, label: 'Content Post', executeAction: 'publish', executeLabel: 'Publish' },
  email: { icon: Mail, label: 'Email', executeAction: 'send', executeLabel: 'Send' },
  meeting: { icon: Calendar, label: 'Meeting', executeAction: 'confirm', executeLabel: 'Confirm to calendar' },
  campaign: { icon: Megaphone, label: 'Campaign', executeAction: null, executeLabel: '—' },
  other: { icon: Inbox, label: 'Other', executeAction: null, executeLabel: '—' },
};

const STATUS_META: Record<DraftStatus, string> = {
  pending: 'badge-warning',
  approved: 'badge-info',
  rejected: 'badge-neutral',
  published: 'badge-success',
  sent: 'badge-success',
  confirmed: 'badge-success',
  expired: 'badge-neutral',
};

function formatTs(ts: string | number): string {
  const ms = typeof ts === 'number' ? ts * 1000 : Date.parse(ts);
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [filter, setFilter] = useState<DraftStatus | 'all'>('pending');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [busyId, setBusyId] = useState<number | null>(null);
  const [sweeping, setSweeping] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/drafts?status=${filter}`, { cache: 'no-store' });
      const json = await res.json();
      setDrafts(json.drafts ?? []);
    } catch (err) { setError((err as Error).message); }
  }, [filter]);

  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, [load]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(id); }, [notice]);

  const NOTICE: Record<string, string> = {
    approve: 'Draft approved',
    reject: 'Draft rejected',
    publish: 'Published',
    send: 'Sent',
    confirm: 'Confirmed to calendar',
  };

  async function act(id: number, action: 'approve' | 'reject' | 'publish' | 'send' | 'confirm') {
    // Optimistic: reflect the new status immediately for the actions that map cleanly.
    const optimisticStatus: Partial<Record<typeof action, DraftStatus>> = {
      approve: 'approved', reject: 'rejected', publish: 'published', send: 'sent', confirm: 'confirmed',
    };
    const prev = drafts;
    const next = optimisticStatus[action];
    if (next) setDrafts((ds) => ds.map((d) => (d.id === id ? { ...d, status: next } : d)));
    try {
      const res = await fetch('/api/drafts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, draft_id: id }) });
      const json = await res.json();
      if (!res.ok) {
        setDrafts(prev); // roll back optimistic update
        setError(json.error || 'Failed');
        setNotice(null);
      } else {
        setError(null);
        setNotice(`${NOTICE[action] ?? 'Done'} · #${id}`);
        await load();
      }
    } catch (err) {
      setDrafts(prev);
      setError((err as Error).message);
      setNotice(null);
    }
  }

  // Per-item "is this still needed?" — reuses the same engine as the issues tab.
  async function revalidate(id: number) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/drafts/${id}/revalidate`, { method: 'POST' });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Re-validation failed'); setNotice(null); }
      else { setError(null); setNotice(`Triaged #${id}`); await load(); }
    } catch (err) { setError((err as Error).message); }
    finally { setBusyId(null); }
  }

  // Batch sweep — re-validates a bounded set of open drafts + issues server-side.
  async function runSweep() {
    setSweeping(true);
    try {
      const res = await fetch('/api/triggers/run-triage', { method: 'POST' });
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Sweep failed'); }
      else { setError(null); setNotice('Triage sweep started — verdicts will appear as they land'); }
    } catch (err) { setError((err as Error).message); }
    finally { setSweeping(false); }
  }

  function toggle(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const pendingCount = drafts.filter((d) => d.status === 'pending').length;

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Drafts</h1>
          <p className="text-xs text-muted-foreground">
            KeyPlayer + sub-agents save drafts here. Nothing executes without your explicit approval.
            {pendingCount > 0 && ` · ${pendingCount} awaiting you`}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={runSweep}
            disabled={sweeping}
            className="btn btn-ghost btn-sm"
            title="Re-validate a batch of open drafts + issues against current goals and what's already shipped, flagging stale ones for your review"
          >
            {sweeping ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Run triage sweep
          </button>
          <div className="flex gap-1">
            {(['pending', 'approved', 'all'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)} className={`tab ${filter === f ? 'active' : ''}`}>
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {notice && (
        <div className="panel p-3 text-xs text-emerald-500 flex items-center gap-1.5">
          <CheckCircle2 size={12} /> {notice}
        </div>
      )}

      {drafts.length === 0 ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          No drafts {filter !== 'all' ? `with status "${filter}"` : 'yet'}. Ask KeyPlayer to draft something — content, email, meeting — and it&apos;ll appear here.
        </div>
      ) : (
        <div className="space-y-2">
          {drafts.map((d) => {
            const meta = TYPE_META[d.type];
            const Icon = meta.icon;
            const isExpanded = expanded.has(d.id);
            const flagged = isFlagged(d);
            const isOpen = d.status === 'pending' || d.status === 'approved';
            return (
              <div key={d.id} className={`panel ${flagged ? 'border-amber-500/50 bg-amber-500/[0.03]' : ''}`}>
                <div className="p-3 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap text-xs">
                    <Icon size={13} className="text-muted-foreground shrink-0" />
                    <span className="font-mono text-[10px] text-muted-foreground">#{d.id}</span>
                    <span className="font-medium">{meta.label}</span>
                    <span className={`badge ${STATUS_META[d.status]}`}>{d.status}</span>
                    {flagged && <span className="badge badge-warning">needs review</span>}
                    <span className="text-muted-foreground">· {formatTs(d.created_at)}</span>
                    <span className="ml-auto flex gap-1">
                      {isOpen && (
                        <button className="btn btn-ghost btn-sm" disabled={busyId === d.id} onClick={() => revalidate(d.id)} title="Re-check whether this draft is still worth acting on">
                          {busyId === d.id ? <Loader2 size={11} className="animate-spin" /> : <ScanSearch size={11} />} Still needed?
                        </button>
                      )}
                      {d.status === 'pending' && (
                        <>
                          <button className="btn btn-success btn-sm" onClick={() => act(d.id, 'approve')}><Check size={11} /> Approve</button>
                          <button className="btn btn-destructive btn-sm" onClick={() => act(d.id, 'reject')}><X size={11} /> Reject</button>
                        </>
                      )}
                      {d.status === 'approved' && meta.executeAction && (
                        <button className="btn btn-primary btn-sm" onClick={() => act(d.id, meta.executeAction!)}>
                          {meta.executeAction === 'send' ? <Send size={11} /> : <CheckCircle2 size={11} />} {meta.executeLabel}
                        </button>
                      )}
                      {d.status === 'approved' && !meta.executeAction && (
                        <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1"><CheckCircle2 size={11} className="text-emerald-500" /> Approved — no further step</span>
                      )}
                    </span>
                  </div>
                  <div className="font-medium text-sm cursor-pointer" onClick={() => toggle(d.id)}>{d.title}</div>
                  {!isExpanded && (
                    <div className="text-xs text-muted-foreground line-clamp-2 cursor-pointer" onClick={() => toggle(d.id)}>{d.payload}</div>
                  )}
                  {isExpanded && (
                    <div className="text-xs whitespace-pre-wrap bg-[var(--surface-2)] p-3 rounded border border-border/60">{d.payload}</div>
                  )}
                  {d.execution_note && (
                    <div className="text-[11px] text-muted-foreground italic">Note: {d.execution_note}</div>
                  )}
                  {d.revalidation && (
                    <div className="text-xs bg-[var(--surface-2)] p-2.5 rounded border border-border/60 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <ScanSearch size={11} className="text-muted-foreground" />
                        <span className="font-medium">Triage</span>
                        <span className={`badge ${d.revalidation.still_needed === 'yes' ? 'badge-success' : d.revalidation.still_needed === 'no' ? 'badge-error' : 'badge-neutral'}`}>
                          still needed: {d.revalidation.still_needed}
                        </span>
                        {d.revalidation.superseded && <span className="badge badge-warning">superseded</span>}
                        {d.revalidated_at != null && <span className="text-[10px] text-muted-foreground ml-auto">checked {formatTs(d.revalidated_at)}</span>}
                      </div>
                      <p className="leading-relaxed whitespace-pre-wrap text-muted-foreground">{d.revalidation.rationale}</p>
                      {d.revalidation.checked_files.length > 0 && (
                        <div className="text-[10px] text-muted-foreground">Files checked: {d.revalidation.checked_files.join(', ')}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
