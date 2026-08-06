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
  Hash,
  Radio,
  FileText,
  CheckCircle2,
  Activity,
  ListChecks,
  ChevronRight,
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

// The signature color each status pill's dot + tint draws from. Keeps the dot in
// sync with the badge variant without re-deriving it from the class string.
const STATUS_DOT: Record<CampaignStatus, string> = {
  active: 'var(--info)',
  paused: 'var(--warning)',
  done: 'var(--success)',
  archived: 'var(--muted-foreground)',
};

function StatusPill({ status }: { status: CampaignStatus }) {
  return (
    <span className={`badge ${STATUS_STYLES[status]} gap-1.5`}>
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: STATUS_DOT[status] }}
      />
      {status}
    </span>
  );
}

// A subtle tinted channel chip. Each channel name hashes to a hue so the same
// channel reads the same color everywhere, without a hard-coded per-channel map.
function channelHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

function ChannelChip({ name }: { name: string }) {
  const hue = channelHue(name);
  const color = `hsl(${hue} 62% 48%)`;
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-micro font-medium leading-none border"
      style={{
        background: `color-mix(in srgb, ${color} 13%, transparent)`,
        color,
        borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      <Radio size={9} className="opacity-80" />
      {name}
    </span>
  );
}

// A single segmented bar visualizing done / running / remaining out of the total.
// Done = primary (solid), running = warning (slightly translucent), remainder =
// the track. A small legend sits underneath.
function MissionProgress({
  total,
  done,
  running,
}: {
  total: number;
  done: number;
  running: number;
}) {
  const safeTotal = Math.max(total, 0);
  const donePct = safeTotal > 0 ? (Math.min(done, safeTotal) / safeTotal) * 100 : 0;
  const runningPct =
    safeTotal > 0 ? (Math.min(running, safeTotal - done) / safeTotal) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div
        className="h-1.5 w-full rounded-full overflow-hidden flex"
        style={{ background: 'color-mix(in srgb, var(--surface-3) 60%, transparent)' }}
      >
        <div
          style={{
            width: `${donePct}%`,
            background: 'var(--primary)',
            transition: 'width var(--t-popover,200ms) var(--ease-out)',
          }}
        />
        <div
          style={{
            width: `${runningPct}%`,
            background: 'color-mix(in srgb, var(--warning) 75%, transparent)',
            transition: 'width var(--t-popover,200ms) var(--ease-out)',
          }}
        />
      </div>
      <div className="flex items-center gap-2 text-micro text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--primary)' }}
          />
          {done} done
        </span>
        <span aria-hidden>·</span>
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full"
            style={{ background: 'var(--warning)' }}
          />
          {running} running
        </span>
        <span aria-hidden>·</span>
        <span>{safeTotal} total</span>
      </div>
    </div>
  );
}

// Per-mission wave cursor — a tiny filled bar showing current_wave / total_waves.
function WaveBar({ current, total }: { current: number; total: number }) {
  const pct = total > 0 ? (Math.min(current, total) / total) * 100 : 0;
  return (
    <div className="flex items-center gap-2 min-w-[88px]">
      <div
        className="h-1 flex-1 rounded-full overflow-hidden"
        style={{ background: 'color-mix(in srgb, var(--surface-3) 55%, transparent)' }}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: 'var(--primary)',
            transition: 'width var(--t-popover,200ms) var(--ease-out)',
          }}
        />
      </div>
      <span className="text-micro text-muted-foreground tabular-nums whitespace-nowrap">
        wave {current}/{total}
      </span>
    </div>
  );
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

  // Shared field-block styling for the create/edit forms — a label with an icon
  // cue above a full-width control.
  function FieldLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
    return (
      <label className="text-small font-medium text-foreground flex items-center gap-1.5">
        <span className="text-muted-foreground">{icon}</span>
        {children}
      </label>
    );
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
          <div className="panel p-3 text-small text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} /> {error}
          </div>
        )}

        <div className="panel">
          <div className="panel-header flex items-start justify-between gap-3 flex-wrap">
            <div className="space-y-2 min-w-0">
              <h3 className="text-h1 flex items-center gap-2 min-w-0">
                <span className="truncate">{c.name}</span>
                <button onClick={openEditor} className="btn btn-ghost btn-sm shrink-0" title="Edit">
                  <Pencil size={11} />
                </button>
              </h3>
              <div className="flex items-center gap-2 flex-wrap">
                <StatusPill status={c.status} />
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-mono text-[10px] text-muted-foreground bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] border border-border/50">
                  <Hash size={9} />
                  {c.id}
                </span>
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap shrink-0">
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
          <div className="panel-body space-y-4">
            {/* Stat tiles — missions total / done / running */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
              <div className="stat-tile">
                <div className="text-micro text-muted-foreground flex items-center gap-1">
                  <ListChecks size={11} /> Missions
                </div>
                <div className="text-h1 mt-0.5 tabular-nums">{c.mission_count}</div>
              </div>
              <div className="stat-tile">
                <div className="text-micro text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 size={11} className="text-[var(--primary)]" /> Done
                </div>
                <div className="text-h1 mt-0.5 tabular-nums text-[var(--primary)]">{c.mission_done}</div>
              </div>
              <div className="stat-tile">
                <div className="text-micro text-muted-foreground flex items-center gap-1">
                  <Activity size={11} className="text-[var(--warning)]" /> Running
                </div>
                <div className="text-h1 mt-0.5 tabular-nums text-[var(--warning)]">{c.mission_running}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-x-6 gap-y-2 text-small">
              <div className="flex items-center gap-1.5">
                <Target size={12} className="text-muted-foreground" />
                <span className="text-muted-foreground">Goal:</span>
                {gTitle ? (
                  <span className="text-foreground">{gTitle}</span>
                ) : (
                  <span className="text-muted-foreground italic">none</span>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <Calendar size={12} className="text-muted-foreground" />
                <span className="text-foreground">{windowLabel(c.starts_at, c.ends_at)}</span>
              </div>
            </div>

            {c.channels.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.channels.map((ch) => (
                  <ChannelChip key={ch} name={ch} />
                ))}
              </div>
            )}

            {editing ? (
              <form onSubmit={submitEdit} className="space-y-4 pt-3 border-t border-border/40">
                <div className="space-y-1.5">
                  <FieldLabel icon={<Waves size={12} />}>Name</FieldLabel>
                  <input
                    className="input"
                    value={edit.name}
                    onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                    required
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <FieldLabel icon={<Target size={12} />}>Goal</FieldLabel>
                    <select
                      className="input"
                      value={edit.goal_id}
                      onChange={(e) => setEdit({ ...edit, goal_id: e.target.value })}
                    >
                      <option value="">— none —</option>
                      {goals.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel icon={<Radio size={12} />}>Channels (comma-separated)</FieldLabel>
                    <input
                      className="input"
                      value={edit.channelsRaw}
                      onChange={(e) => setEdit({ ...edit, channelsRaw: e.target.value })}
                      placeholder="linkedin, x, email"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel icon={<Calendar size={12} />}>Starts</FieldLabel>
                    <input
                      className="input"
                      type="date"
                      value={edit.starts_at}
                      onChange={(e) => setEdit({ ...edit, starts_at: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <FieldLabel icon={<Calendar size={12} />}>Ends</FieldLabel>
                    <input
                      className="input"
                      type="date"
                      value={edit.ends_at}
                      onChange={(e) => setEdit({ ...edit, ends_at: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <FieldLabel icon={<FileText size={12} />}>Brief</FieldLabel>
                  <textarea
                    className="input"
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
              <div
                className="rounded-lg p-3.5 border border-border/40 space-y-1.5"
                style={{ background: 'color-mix(in srgb, var(--surface-1) 60%, transparent)' }}
              >
                <div className="text-micro text-muted-foreground flex items-center gap-1.5 uppercase tracking-wide">
                  <FileText size={11} /> Brief
                </div>
                <div className="text-body whitespace-pre-wrap">
                  {c.brief.trim() || <span className="text-muted-foreground italic">No brief yet.</span>}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header flex items-center justify-between gap-3 flex-wrap">
            <h3 className="text-h2 flex items-center gap-2">
              <ListChecks size={15} className="text-muted-foreground" /> Missions
            </h3>
            <button className="btn btn-primary btn-sm" onClick={launchMission}>
              <Rocket size={11} /> Launch new mission
            </button>
          </div>
          <div className="panel-body">
            {detailLoading && (
              <div className="text-small text-muted-foreground flex items-center gap-1.5">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            )}
            {!detailLoading && detail.missions.length === 0 && (
              <div className="rounded-lg border border-dashed border-border/60 px-4 py-8 text-center space-y-1">
                <Rocket size={18} className="mx-auto text-muted-foreground" />
                <div className="text-small text-muted-foreground">
                  No missions in this campaign yet. Launch one to kick it off.
                </div>
              </div>
            )}
            {detail.missions.length > 0 && (
              <ul className="space-y-2">
                {detail.missions.map((m) => (
                  <li
                    key={m.id}
                    className="group flex items-center justify-between gap-3 p-3 rounded-lg border border-border/50"
                    style={{
                      background: 'color-mix(in srgb, var(--surface-1) 50%, transparent)',
                      transition:
                        'border-color var(--t-press,120ms) var(--ease-out), background-color var(--t-press,120ms) var(--ease-out)',
                    }}
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="text-body font-medium truncate">{m.title}</div>
                      <div className="text-micro text-muted-foreground flex items-center gap-2 flex-wrap">
                        <span className="font-mono">{m.id}</span>
                        <span aria-hidden>·</span>
                        <span className="capitalize">{m.status}</span>
                      </div>
                      <WaveBar current={m.current_wave} total={m.total_waves} />
                    </div>
                    <a
                      href={`/missions/${m.id}`}
                      className="btn btn-ghost btn-sm shrink-0 inline-flex items-center gap-1"
                    >
                      Open <ChevronRight size={11} />
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
        <div className="panel p-3 text-small text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </div>
      )}

      {creating && (
        <form onSubmit={submitNew} className="panel p-5 space-y-4">
          <div className="space-y-1.5">
            <FieldLabel icon={<Waves size={12} />}>Name</FieldLabel>
            <input
              className="input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="Q3 product launch push"
              required
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <FieldLabel icon={<Target size={12} />}>Goal (optional)</FieldLabel>
              <select
                className="input"
                value={draft.goal_id}
                onChange={(e) => setDraft({ ...draft, goal_id: e.target.value })}
              >
                <option value="">— none —</option>
                {goals.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <FieldLabel icon={<Radio size={12} />}>Channels (comma-separated)</FieldLabel>
              <input
                className="input"
                value={draft.channelsRaw}
                onChange={(e) => setDraft({ ...draft, channelsRaw: e.target.value })}
                placeholder="linkedin, x, email"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel icon={<Calendar size={12} />}>Starts</FieldLabel>
              <input
                className="input"
                type="date"
                value={draft.starts_at}
                onChange={(e) => setDraft({ ...draft, starts_at: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel icon={<Calendar size={12} />}>Ends</FieldLabel>
              <input
                className="input"
                type="date"
                value={draft.ends_at}
                onChange={(e) => setDraft({ ...draft, ends_at: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <FieldLabel icon={<FileText size={12} />}>Brief (optional)</FieldLabel>
            <textarea
              className="input"
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
        <div className="panel px-6 py-12 text-center flex flex-col items-center gap-3">
          <span
            className="grid place-items-center w-12 h-12 rounded-full"
            style={{
              background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
              color: 'var(--primary)',
            }}
          >
            <Waves size={22} />
          </span>
          <div className="space-y-1">
            <div className="text-h2">No campaigns yet</div>
            <div className="text-small text-muted-foreground max-w-sm mx-auto">
              Spin up your first campaign to bundle missions toward a goal across channels and dates.
            </div>
          </div>
          <button onClick={() => setCreating(true)} className="btn btn-primary btn-sm">
            <Plus size={12} /> New campaign
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-stagger>
        {campaigns.map((c) => {
          const gTitle = goalTitle(c.goal_id);
          return (
            <button
              key={c.id}
              onClick={() => setSelectedId(c.id)}
              className="campaign-card panel text-left flex flex-col"
              style={{
                transition:
                  'transform var(--t-popover,200ms) var(--ease-out), border-color var(--t-popover,200ms) var(--ease-out), box-shadow var(--t-popover,200ms) var(--ease-out)',
              }}
            >
              <div className="panel-header flex items-start justify-between gap-3">
                <div className="space-y-1 min-w-0">
                  <h3 className="text-h2 truncate">{c.name}</h3>
                  {gTitle ? (
                    <div className="text-small text-muted-foreground flex items-center gap-1.5 min-w-0">
                      <Target size={11} className="shrink-0" />
                      <span className="truncate">{gTitle}</span>
                    </div>
                  ) : (
                    <div className="text-micro text-muted-foreground italic">No goal linked</div>
                  )}
                </div>
                <StatusPill status={c.status} />
              </div>
              <div className="panel-body space-y-3 flex-1 flex flex-col">
                {c.channels.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {c.channels.map((ch) => (
                      <ChannelChip key={ch} name={ch} />
                    ))}
                  </div>
                ) : (
                  <div className="text-micro text-muted-foreground italic">No channels set</div>
                )}

                <div className="text-small text-muted-foreground flex items-center gap-1.5">
                  <Calendar size={11} className="shrink-0" /> {windowLabel(c.starts_at, c.ends_at)}
                </div>

                <div className="mt-auto pt-1">
                  <MissionProgress
                    total={c.mission_count}
                    done={c.mission_done}
                    running={c.mission_running}
                  />
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
