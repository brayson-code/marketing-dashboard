'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Waves,
  Plus,
  Pencil,
  ArrowLeft,
  AlertCircle,
  Target,
  Calendar,
  Rocket,
  Loader2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';

type CampaignStatus = 'active' | 'paused' | 'done' | 'archived';

interface Campaign {
  id: string;
  name: string;
  goal_id: string | null;
  channels: string[];
  starts_at: string | null;
  ends_at: string | null;
  status: CampaignStatus;
  brief: string;
  created_at: string;
  updated_at: string;
  mission_count: number;
  mission_done: number;
  mission_running: number;
}

interface CampaignMission {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  updated_at: string;
}

interface Goal {
  id: string;
  title: string;
  status: string;
}

const STATUS_STYLES: Record<CampaignStatus, string> = {
  active: 'badge-info',
  paused: 'badge-warning',
  done: 'badge-success',
  archived: 'badge-neutral',
};

function StatusPill({ status }: { status: CampaignStatus }) {
  return <span className={`badge ${STATUS_STYLES[status]}`}>{status}</span>;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toISOString().slice(0, 10);
}

function windowLabel(starts: string | null, ends: string | null): string {
  if (!starts && !ends) return 'Open-ended';
  if (starts && ends) return `${fmtDate(starts)} → ${fmtDate(ends)}`;
  if (starts) return `from ${fmtDate(starts)}`;
  return `until ${fmtDate(ends)}`;
}

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<{ campaign: Campaign; missions: CampaignMission[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [editing, setEditing] = useState(false);

  const blankDraft = {
    name: '',
    goal_id: '',
    channelsRaw: '',
    starts_at: '',
    ends_at: '',
    brief: '',
  };
  const [draft, setDraft] = useState(blankDraft);
  const [edit, setEdit] = useState(blankDraft);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/campaigns', { cache: 'no-store' });
      const json = await res.json();
      setCampaigns(json.campaigns ?? []);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const loadGoals = useCallback(async () => {
    try {
      const res = await fetch('/api/goals', { cache: 'no-store' });
      const json = await res.json();
      setGoals(json.goals ?? []);
    } catch {
      /* goals are optional — silent fail */
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${id}`, { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to load');
        setDetail(null);
      } else {
        setDetail({ campaign: json.campaign, missions: json.missions ?? [] });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadList();
    loadGoals();
  }, [loadList, loadGoals]);

  useEffect(() => {
    if (selectedId) loadDetail(selectedId);
    else setDetail(null);
  }, [selectedId, loadDetail]);

  function goalTitle(id: string | null): string | null {
    if (!id) return null;
    return goals.find((g) => g.id === id)?.title ?? id;
  }

  function parseChannels(raw: string): string[] {
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  async function submitNew(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.name.trim()) return;
    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'create',
          name: draft.name.trim(),
          goal_id: draft.goal_id || null,
          channels: parseChannels(draft.channelsRaw),
          starts_at: draft.starts_at || null,
          ends_at: draft.ends_at || null,
          brief: draft.brief.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to create');
        return;
      }
      setError(null);
      setDraft(blankDraft);
      setCreating(false);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    try {
      const res = await fetch(`/api/campaigns/${detail.campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: edit.name.trim(),
          goal_id: edit.goal_id || null,
          channels: parseChannels(edit.channelsRaw),
          starts_at: edit.starts_at || null,
          ends_at: edit.ends_at || null,
          brief: edit.brief,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || 'Failed to update');
        return;
      }
      setError(null);
      setEditing(false);
      await loadDetail(detail.campaign.id);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function changeStatus(next: CampaignStatus) {
    if (!detail) return;
    try {
      const res = await fetch(`/api/campaigns/${detail.campaign.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error || 'Failed');
        return;
      }
      await loadDetail(detail.campaign.id);
      await loadList();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  function openEditor() {
    if (!detail) return;
    const c = detail.campaign;
    setEdit({
      name: c.name,
      goal_id: c.goal_id ?? '',
      channelsRaw: c.channels.join(', '),
      starts_at: fmtDate(c.starts_at),
      ends_at: fmtDate(c.ends_at),
      brief: c.brief,
    });
    setEditing(true);
  }

  async function launchMission() {
    if (!detail) return;
    const brief = detail.campaign.brief.trim() || detail.campaign.name;
    try {
      const res = await fetch('/api/missions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request: brief, campaign_id: detail.campaign.id }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        // The /api/missions handler hasn't been taught about campaign_id yet —
        // surface a clear "coming soon" rather than a cryptic 404/400.
        if (res.status === 404) {
          setError('Mission launcher not wired yet — coming soon.');
        } else {
          setError(json.error || 'Failed to launch mission');
        }
        return;
      }
      await loadDetail(detail.campaign.id);
      await loadList();
    } catch {
      setError('Mission launcher not wired yet — coming soon.');
    }
  }

  // -------- Detail view --------
  if (selectedId && detail) {
    const c = detail.campaign;
    const gTitle = goalTitle(c.goal_id);
    return (
      <div className="space-y-4 animate-in">
        <button
          onClick={() => {
            setSelectedId(null);
            setEditing(false);
          }}
          className="btn btn-ghost btn-sm"
        >
          <ArrowLeft size={12} /> All campaigns
        </button>

        {error && (
          <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        <div className="panel">
          <div className="panel-header flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-[10px] text-muted-foreground">{c.id}</span>
                <StatusPill status={c.status} />
              </div>
              <h3 className="text-h2 flex items-center gap-2">
                <span className="truncate">{c.name}</span>
                <button onClick={openEditor} className="btn btn-ghost btn-sm" title="Edit">
                  <Pencil size={11} />
                </button>
              </h3>
            </div>
            <div className="flex gap-1 flex-wrap">
              {c.status === 'active' && (
                <button className="btn btn-ghost btn-sm" onClick={() => changeStatus('paused')}>
                  Pause
                </button>
              )}
              {c.status === 'paused' && (
                <button className="btn btn-ghost btn-sm" onClick={() => changeStatus('active')}>
                  Resume
                </button>
              )}
              {c.status !== 'done' && c.status !== 'archived' && (
                <button className="btn btn-ghost btn-sm" onClick={() => changeStatus('done')}>
                  Mark done
                </button>
              )}
              {c.status !== 'archived' && (
                <button className="btn btn-ghost btn-sm" onClick={() => changeStatus('archived')}>
                  Archive
                </button>
              )}
            </div>
          </div>
          <div className="panel-body space-y-3">
            <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
              <div className="flex items-center gap-1.5">
                <Target size={12} className="text-muted-foreground" />
                <span className="text-muted-foreground">Goal:</span>
                {gTitle ? <span>{gTitle}</span> : <span className="text-muted-foreground italic">none</span>}
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-muted-foreground" />
                <span>{windowLabel(c.starts_at, c.ends_at)}</span>
              </div>
            </div>

            {c.channels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.channels.map((ch) => (
                  <span key={ch} className="badge badge-neutral">
                    {ch}
                  </span>
                ))}
              </div>
            )}

            {editing ? (
              <form onSubmit={submitEdit} className="space-y-3 pt-2 border-t border-border/40">
                <div className="space-y-1">
                  <label className="text-xs font-medium">Name</label>
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} required />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Goal</label>
                    <select value={edit.goal_id} onChange={(e) => setEdit({ ...edit, goal_id: e.target.value })}>
                      <option value="">— none —</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Channels (comma-separated)</label>
                    <input
                      value={edit.channelsRaw}
                      onChange={(e) => setEdit({ ...edit, channelsRaw: e.target.value })}
                      placeholder="linkedin, x, email"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Starts</label>
                    <input
                      type="date"
                      value={edit.starts_at}
                      onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium">Ends</label>
                    <input
                      type="date"
                      value={edit.ends_at}
                      onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium">Brief</label>
                  <textarea
                    value={edit.brief}
                    onChange={(e) => setEdit({ ...edit, brief: e.target.value })}
                    rows={4}
                    placeholder="What this campaign is going after — the agents will read this."
                  />
                </div>
                <div className="flex gap-2">
                  <button type="submit" className="btn btn-primary">
                    Save
                  </button>
                  <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground">Brief</div>
                <div className="text-sm whitespace-pre-wrap">
                  {c.brief.trim() || <span className="text-muted-foreground italic">No brief yet.</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-h2">Missions</h3>
            <button className="btn btn-primary btn-sm" onClick={launchMission}>
              <Rocket size={11} /> Launch new mission
            </button>
          </div>
          <div className="panel-body">
            {detailLoading && (
              <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            )}
            {!detailLoading && detail.missions.length === 0 && (
              <div className="text-xs text-muted-foreground">
                No missions in this campaign yet. Launch one to kick it off.
              </div>
            )}
            {detail.missions.length > 0 && (
              <ul className="space-y-2">
                {detail.missions.map((m) => (
                  <li
                    key={m.id}
                    className="flex items-start justify-between gap-3 p-2 rounded border border-border/40"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-sm font-medium truncate">{m.title}</div>
                      <div className="text-[11px] text-muted-foreground flex gap-2 flex-wrap">
                        <span className="font-mono">{m.id}</span>
                        <span>·</span>
                        <span>{m.status}</span>
                        <span>·</span>
                        <span>
                          wave {m.current_wave}/{m.total_waves}
                        </span>
                      </div>
                    </div>
                    <a href={`/missions/${m.id}`} className="btn btn-ghost btn-sm">
                      Open
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------- List view --------
  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Waves size={20} />}
        title="Campaigns"
        subtitle="Multi-week pushes — each one bundles missions toward a goal."
        actions={
          <button onClick={() => setCreating((c) => !c)} className="btn btn-primary btn-sm">
            <Plus size={12} /> New campaign
          </button>
        }
      />

      <Explainer
        id="campaigns"
        title="Campaigns"
        what="a themed, multi-channel push toward a goal over a date range."
        when="you're running a coordinated effort across channels (a launch, a month of LinkedIn, a webinar promo)."
        example="'Q3 LinkedIn thought-leadership' — a goal + channels + dates, with agent missions running under it."
      />

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {creating && (
        <form onSubmit={submitNew} className="panel p-4 space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium">Name</label>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Q3 product launch push"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium">Goal (optional)</label>
              <select value={draft.goal_id} onChange={(e) => setDraft({ ...draft, goal_id: e.target.value })}>
                <option value="">— none —</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Channels (comma-separated)</label>
              <input
                value={draft.channelsRaw}
                onChange={(e) => setDraft({ ...draft, channelsRaw: e.target.value })}
                placeholder="linkedin, x, email"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Starts</label>
              <input
                type="date"
                value={draft.starts_at}
                onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium">Ends</label>
              <input
                type="date"
                value={draft.ends_at}
                onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium">Brief (optional)</label>
            <textarea
              value={draft.brief}
              onChange={(e) => setDraft({ ...draft, brief: e.target.value })}
              rows={3}
              placeholder="What this campaign is going after — the agents will read this."
            />
          </div>
          <div className="flex gap-2">
            <button type="submit" className="btn btn-primary">
              Create
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {campaigns.length === 0 && !creating && (
        <div className="panel p-6 text-center space-y-2">
          <Waves size={20} className="mx-auto text-muted-foreground" />
          <div className="text-sm">No campaigns yet.</div>
          <div className="text-xs text-muted-foreground">
            Spin up your first campaign to bundle missions toward a goal.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {campaigns.map((c) => {
          const gTitle = goalTitle(c.goal_id);
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="panel text-left hover:border-[var(--primary)]/40 transition-colors"
            >
              <div className="panel-header flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <h3 className="text-h2 truncate">{c.name}</h3>
                  {gTitle && (
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Target size={11} /> {gTitle}
                    </div>
                  )}
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="panel-body space-y-2">
                {c.channels.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {c.channels.map((ch) => (
                      <span key={ch} className="badge badge-neutral">
                        {ch}
                      </span>
                    ))}
                  </div>
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">No channels set</div>
                )}
                <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <Calendar size={11} /> {windowLabel(c.starts_at, c.ends_at)}
                </div>
                <div className="text-xs pt-1 border-t border-border/40">
                  <span className="font-medium">{c.mission_count}</span> missions ·{' '}
                  <span className="text-[var(--primary)]">{c.mission_done}</span> done ·{' '}
                  <span className="text-[var(--warning)]">{c.mission_running}</span> running
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
