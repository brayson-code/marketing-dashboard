'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dna, Check, X, Plus, Power, AlertCircle, Pencil, RotateCcw, Trophy } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

type GeneStatus = 'proposed' | 'active' | 'retired';

interface Gene {
  id: number;
  name: string;
  title: string;
  body: string;
  role: string;
  agent_id: string | null;
  status: GeneStatus;
  version: number;
  tries: number;
  wins: number;
  reward_mean: number;
  source: string | null;
  created_by: string | null;
  updated_at: string;
}

const ROLES = ['research', 'content', 'outreach', 'scheduler', 'creative', 'general'];
const INPUT = 'px-3 py-2 rounded-lg border border-border bg-background'; // app input convention
const STATUS_BADGE: Record<GeneStatus, string> = { active: 'badge-success', proposed: 'badge-warning', retired: 'badge-neutral' };
const FILTERS: Array<GeneStatus | 'all'> = ['active', 'proposed', 'retired', 'all'];

export default function GenesPage() {
  const [genes, setGenes] = useState<Gene[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<GeneStatus | 'all'>('active');
  const [minting, setMinting] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [draft, setDraft] = useState({ title: '', body: '', role: 'research', agentId: '' });

  const load = useCallback(async () => {
    try {
      const q = filter === 'all' ? '' : `?status=${filter}`;
      const res = await fetch(`/api/genes${q}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setGenes(json.genes ?? []);
      setEnabled(json.enabled ?? true);
      setError(null);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next); // optimistic
    try {
      const res = await fetch('/api/genes', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
      if (!res.ok) { setEnabled(!next); const j = await res.json(); setError(j.error || 'Toggle failed'); }
    } catch (e) { setEnabled(!next); setError((e as Error).message); }
  }

  async function patch(id: number, body: Record<string, unknown>) {
    try {
      const res = await fetch(`/api/genes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await res.json();
      if (!res.ok) setError(j.error || 'Update failed');
      else { setError(null); setEditId(null); await load(); }
    } catch (e) { setError((e as Error).message); }
  }

  async function mint() {
    if (!draft.title.trim() || !draft.body.trim()) { setError('Title and body are required'); return; }
    try {
      const res = await fetch('/api/genes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: draft.title, body: draft.body, role: draft.role, agentId: draft.agentId.trim() || null }),
      });
      const j = await res.json();
      if (!res.ok) setError(j.error || 'Mint failed');
      else { setError(null); setMinting(false); setDraft({ title: '', body: '', role: 'research', agentId: '' }); await load(); }
    } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Dna size={18} className="text-primary" /> Strategy Genes</h1>
          <p className="text-xs text-muted-foreground">
            Named, versioned lessons the agents learn. <b>Active</b> genes are injected into matching agents&apos; tasks;
            <b> proposed</b> ones are inert until you approve them. Toggle the master switch to stop using all genes instantly.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={toggleEnabled}
            className={`btn btn-sm ${enabled ? 'btn-ghost' : 'btn-destructive'}`}
            title={enabled ? 'Genes are ON — active genes are injected into agents. Click to turn OFF instantly.' : 'Genes are OFF — agents behave as before. Click to turn ON.'}
          >
            <Power size={12} className={enabled ? 'text-emerald-500' : ''} /> {enabled ? 'Genes: ON' : 'Genes: OFF'}
          </button>
          <button onClick={() => setMinting((m) => !m)} className="btn btn-primary btn-sm"><Plus size={12} /> Mint gene</button>
        </div>
      </div>

      {!enabled && (
        <div className="panel p-3 text-xs flex items-center gap-1.5 text-amber-500">
          <Power size={12} /> Genes are globally OFF — no agent is using any gene right now. Agents behave exactly as they did before this feature.
        </div>
      )}

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5"><AlertCircle size={12} /> {error}</div>
      )}

      {minting && (
        <div className="panel p-3 space-y-2">
          <div className="text-sm font-medium">Mint a new gene (born active)</div>
          <input className={`${INPUT} w-full text-sm`} placeholder="Title — e.g. Lead with the number"
            value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <textarea className={`${INPUT} w-full text-[13px] leading-6 min-h-[120px] resize-y font-mono`}
            placeholder="The instruction to inject — e.g. When sizing up a competitor, open with the hard metric (price, market size) before the story."
            value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
          <div className="flex gap-2 flex-wrap items-center">
            <select className={`${INPUT} text-sm`} value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            <input className={`${INPUT} text-sm`} placeholder="agent id (optional — blank = whole role)"
              value={draft.agentId} onChange={(e) => setDraft({ ...draft, agentId: e.target.value })} />
            <button onClick={mint} className="btn btn-success btn-sm"><Check size={12} /> Mint</button>
            <button onClick={() => setMinting(false)} className="btn btn-ghost btn-sm">Cancel</button>
          </div>
        </div>
      )}

      <div className="flex gap-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)} className={`tab ${filter === f ? 'active' : ''}`}>{f}</button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-24 w-full" />)}</div>
      ) : genes.length === 0 ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          No {filter !== 'all' ? filter : ''} genes yet. Mint one, or let the reward loop propose them as variants prove themselves.
        </div>
      ) : (
        <div className="space-y-2">
          {genes.map((g) => (
            <div key={g.id} className="panel p-3 space-y-2">
              <div className="flex items-center gap-2 flex-wrap text-xs">
                <Dna size={13} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-sm">{g.title}</span>
                <span className={`badge ${STATUS_BADGE[g.status]}`}>{g.status}</span>
                <span className="badge badge-neutral">{g.role}</span>
                {g.agent_id ? <span className="text-muted-foreground">· {g.agent_id}</span> : <span className="text-muted-foreground">· whole role</span>}
                <span className="text-muted-foreground">· v{g.version}</span>
                {g.tries > 0 && (
                  <span className="text-muted-foreground inline-flex items-center gap-1">
                    · <Trophy size={10} /> {g.wins}/{g.tries} wins · μ {g.reward_mean.toFixed(2)}
                  </span>
                )}
                <span className="ml-auto flex gap-1">
                  {g.status === 'proposed' && (
                    <button className="btn btn-success btn-sm" onClick={() => patch(g.id, { status: 'active' })}><Check size={11} /> Approve</button>
                  )}
                  {g.status === 'active' && (
                    <button className="btn btn-destructive btn-sm" onClick={() => patch(g.id, { status: 'retired' })}><X size={11} /> Retire</button>
                  )}
                  {g.status === 'retired' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => patch(g.id, { status: 'active' })}><RotateCcw size={11} /> Reactivate</button>
                  )}
                  <button className="btn btn-ghost btn-sm" onClick={() => { setEditId(editId === g.id ? null : g.id); setDraft({ title: g.title, body: g.body, role: g.role, agentId: g.agent_id ?? '' }); }}>
                    <Pencil size={11} /> Edit
                  </button>
                </span>
              </div>

              {editId === g.id ? (
                <div className="space-y-2">
                  <input className={`${INPUT} w-full text-sm`} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
                  <textarea className={`${INPUT} w-full text-[13px] leading-6 min-h-[120px] resize-y font-mono`} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
                  <div className="flex gap-2">
                    <button className="btn btn-success btn-sm" onClick={() => patch(g.id, { title: draft.title, body: draft.body })}><Check size={11} /> Save</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div className="text-xs whitespace-pre-wrap bg-[var(--surface-2)] p-2.5 rounded border border-border/60">{g.body}</div>
              )}

              {g.source && <div className="text-[11px] text-muted-foreground italic">Origin: {g.source}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
