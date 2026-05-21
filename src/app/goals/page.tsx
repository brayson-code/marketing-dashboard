'use client';

import { useCallback, useEffect, useState } from 'react';
import { Target, CheckCircle2, Clock, AlertCircle, Plus, RotateCcw, Check } from 'lucide-react';

type GoalStatus = 'active' | 'pending_verification' | 'done' | 'abandoned';

interface GoalProgress { ts: string; note: string }

interface Goal {
  id: string;
  title: string;
  owner: string;
  status: GoalStatus;
  created: string;
  due?: string | null;
  success: string;
  progress: GoalProgress[];
}

function StatusBadge({ status }: { status: GoalStatus }) {
  const map: Record<GoalStatus, { cls: string; label: string; icon: typeof Target }> = {
    active: { cls: 'badge-info', label: 'active', icon: Target },
    pending_verification: { cls: 'badge-warning', label: 'pending review', icon: Clock },
    done: { cls: 'badge-success', label: 'done', icon: CheckCircle2 },
    abandoned: { cls: 'badge-neutral', label: 'abandoned', icon: AlertCircle },
  };
  const m = map[status];
  const Icon = m.icon;
  return <span className={`badge ${m.cls} inline-flex items-center gap-1`}><Icon size={11} />{m.label}</span>;
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ title: '', success: '', due: '' });

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/goals', { cache: 'no-store' });
      const json = await res.json();
      setGoals(json.goals ?? []);
    } catch (err) { setError((err as Error).message); }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

  async function postAction(body: Record<string, unknown>) {
    try {
      const res = await fetch('/api/goals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) setError(json.error || 'Failed');
      else { setError(null); await load(); }
    } catch (err) { setError((err as Error).message); }
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim() || !draft.success.trim()) return;
    await postAction({ action: 'create', title: draft.title.trim(), success: draft.success.trim(), due: draft.due.trim() || undefined });
    setDraft({ title: '', success: '', due: '' });
    setCreating(false);
  }

  const active = goals.filter((g) => g.status === 'active' || g.status === 'pending_verification');
  const archive = goals.filter((g) => g.status === 'done' || g.status === 'abandoned');

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Goals</h1>
          <p className="text-xs text-muted-foreground">KeyPlayer reads + writes these via tools. You always get the final word.</p>
        </div>
        <button onClick={() => setCreating((c) => !c)} className="btn btn-ghost"><Plus size={14} /> New goal</button>
      </div>

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {creating && (
        <form onSubmit={submitNew} className="panel p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Title</label>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Reach $10K MRR" required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Success criteria (must be verifiable)</label>
            <textarea value={draft.success} onChange={(e) => setDraft({ ...draft, success: e.target.value })} rows={2} required placeholder="Verified MRR ≥ $10,000 in Stripe + CRM" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Due (YYYY-MM-DD, optional)</label>
            <input value={draft.due} onChange={(e) => setDraft({ ...draft, due: e.target.value })} placeholder="2026-06-30" />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">Create</button>
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </form>
      )}

      {active.length === 0 && !creating && (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          No active goals. KeyPlayer can create them via the <code>create_goal</code> tool, or click "New goal" above.
        </div>
      )}

      <div className="space-y-2">
        {active.map((g) => (
          <div key={g.id} className="panel p-4 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="space-y-0.5 min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-[10px] text-muted-foreground">{g.id}</span>
                  <StatusBadge status={g.status} />
                  {g.due && <span className="text-[11px] text-muted-foreground">due {g.due}</span>}
                </div>
                <div className="font-semibold text-sm">{g.title}</div>
                <div className="text-xs text-muted-foreground">{g.success}</div>
              </div>
              <div className="flex gap-1 flex-wrap">
                {g.status === 'pending_verification' && (
                  <button className="btn btn-success btn-sm" onClick={() => postAction({ action: 'set_status', goal_id: g.id, status: 'done', note: 'verified by owner' })}>
                    <Check size={11} /> Confirm done
                  </button>
                )}
                {g.status !== 'active' && (
                  <button className="btn btn-ghost btn-sm" onClick={() => postAction({ action: 'set_status', goal_id: g.id, status: 'active', note: 'reverted by owner' })}>
                    <RotateCcw size={11} /> Revert
                  </button>
                )}
                {g.status === 'active' && (
                  <button className="btn btn-destructive btn-sm" onClick={() => postAction({ action: 'set_status', goal_id: g.id, status: 'abandoned', note: 'abandoned by owner' })}>
                    Abandon
                  </button>
                )}
              </div>
            </div>
            {g.progress.length > 0 && (
              <details>
                <summary className="text-xs text-muted-foreground cursor-pointer">{g.progress.length} progress entries</summary>
                <ul className="text-xs space-y-1 pt-2">
                  {g.progress.slice().reverse().map((p, i) => (
                    <li key={i} className="flex gap-2"><span className="font-mono text-muted-foreground shrink-0">{p.ts}</span><span>{p.note}</span></li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        ))}
      </div>

      {archive.length > 0 && (
        <details className="pt-4">
          <summary className="section-title cursor-pointer">Archive ({archive.length})</summary>
          <div className="space-y-2 pt-2">
            {archive.map((g) => (
              <div key={g.id} className="panel p-3 space-y-1 opacity-70">
                <div className="flex items-center gap-2 flex-wrap text-xs">
                  <StatusBadge status={g.status} />
                  <span className="font-medium">{g.title}</span>
                </div>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
