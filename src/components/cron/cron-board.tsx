'use client';

import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, History, Pencil, Plus, Trash2, X, BookmarkPlus, Wand2 } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { toast } from '@/components/ui/toast';
import { Skeleton } from '@/components/ui/skeleton';
import { cronToHuman, SCHEDULE_PRESETS } from '@/lib/cron-human';

interface CronJob {
  id: string;
  name?: string;
  agentId?: string;
  skill?: string;
  enabled?: boolean;
  schedule?: { expr?: string; tz?: string };
  payload?: { model?: string; message?: string };
  state?: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    lastError?: string;
    nextRunAtMs?: number;
  };
  lastRun?: string | null;
  lastResult?: string | null;
}

interface CronStatusPayload {
  jobs: CronJob[];
  can_write?: boolean;
  can_templates_write?: boolean;
}

interface CronTemplate {
  id: string;
  name: string;
  description?: string | null;
  job_json: string;
  updated_at_ms?: number;
}

interface CronRun {
  ts?: number | string | null;
  status?: string;
  durationMs?: number | null;
  summary?: string | null;
  error?: string | null;
  nextRunAtMs?: number | null;
}

// ── Category resolver ─────────────────────────────────────────────────────────

type Category = 'Executive suite' | 'Research & intel' | 'Content' | 'Operations' | 'Custom';

const CATEGORY_ORDER: Category[] = ['Executive suite', 'Research & intel', 'Content', 'Operations', 'Custom'];

function resolveCategory(agentId?: string): Category {
  const id = agentId ?? '';
  if (id.startsWith('ai-')) return 'Executive suite';
  if (['research-analyst', 'reel-analyst', 'lead-research'].includes(id)) return 'Research & intel';
  if (['content-writer', 'hyperframes-agent', 'reel-ideator', 'thumbnail-generator', 'content-cascade', 'carousel-generator'].includes(id)) return 'Content';
  if (['fixer', 'improver', 'memory-compactor', 'keyplayer'].includes(id)) return 'Operations';
  return 'Custom';
}

// ── Formatters ────────────────────────────────────────────────────────────────

function formatTime(ms?: number) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
}

function formatRunTs(ts?: number | string | null) {
  if (!ts) return '—';
  if (typeof ts === 'number') return new Date(ts).toLocaleString();
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
}

// ── Schedule editor sub-component ─────────────────────────────────────────────

function isSubHourMinuteStep(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const m = parts[0].match(/^\*\/(\d+)$/);
  if (!m) return false;
  const step = parseInt(m[1], 10);
  return step > 0 && step < 60;
}

interface ScheduleEditorProps {
  value: string;
  onChange: (expr: string) => void;
  tz?: string;
}

function ScheduleEditor({ value, onChange, tz }: ScheduleEditorProps) {
  const isCustom = !SCHEDULE_PRESETS.some((p) => p.expr === value);
  const [showCustom, setShowCustom] = useState(isCustom);

  const humanPreview = cronToHuman(value, tz);
  const subHour = isSubHourMinuteStep(value);

  return (
    <div className="space-y-2">
      {/* Preset chips */}
      <div className="flex flex-wrap gap-1.5">
        {SCHEDULE_PRESETS.map((p) => (
          <button
            key={p.expr}
            type="button"
            className={`tab${value === p.expr && !showCustom ? ' active' : ''}`}
            onClick={() => {
              onChange(p.expr);
              setShowCustom(false);
            }}
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          className={`tab${showCustom ? ' active' : ''}`}
          onClick={() => setShowCustom(true)}
        >
          Custom
        </button>
      </div>

      {/* Custom raw input */}
      {showCustom && (
        <input
          className="input font-mono text-xs w-full"
          placeholder="e.g. 0 9 * * 1-5"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom cron expression"
        />
      )}

      {/* Live preview */}
      <div className="text-[11px] text-muted-foreground flex flex-wrap items-center gap-1">
        <span>= {humanPreview}</span>
        {subHour && (
          <span className="text-warning">(runs hourly — sub-hour schedules round up)</span>
        )}
      </div>
    </div>
  );
}

// ── Schedule section in the JSON editor
// When user edits the JSON textarea directly, we also show a helper above it.

// ── CronBoard ─────────────────────────────────────────────────────────────────

export function CronBoard({ variant = 'embedded' }: { variant?: 'page' | 'embedded' }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data, loading } = useSmartPoll<CronStatusPayload>(
    () => fetch('/api/cron').then(r => r.json()),
    { interval: 30_000, key: refreshKey },
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [optimisticEnabled, setOptimisticEnabled] = useState<Record<string, boolean>>({});
  const [runs, setRuns] = useState<Record<string, CronRun[]>>({});
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({});
  const [editOpen, setEditOpen] = useState(false);
  const [editMode, setEditMode] = useState<'create' | 'edit'>('edit');
  const [editJobId, setEditJobId] = useState<string | null>(null);
  const [editJson, setEditJson] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [templates, setTemplates] = useState<CronTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateId, setTemplateId] = useState<string>('');
  const [nlPrompt, setNlPrompt] = useState('');
  const [nlBusy, setNlBusy] = useState(false);

  // Parsed schedule.expr from the JSON editor for the live schedule preview
  const editorScheduleExpr = useMemo(() => {
    try {
      const parsed = JSON.parse(editJson) as { schedule?: { expr?: string } };
      return parsed?.schedule?.expr ?? '';
    } catch {
      return '';
    }
  }, [editJson]);

  const jobs = useMemo(() => {
    const base = data?.jobs ?? [];
    if (Object.keys(optimisticEnabled).length === 0) return base;
    return base.map((j) => (j.id in optimisticEnabled ? { ...j, enabled: optimisticEnabled[j.id] } : j));
  }, [data?.jobs, optimisticEnabled]);
  const canWrite = !!data?.can_write;
  const canTemplatesWrite = !!data?.can_templates_write;

  const summary = useMemo(() => {
    const total = jobs.length;
    const errors = jobs.filter(j => {
      const s = j.state?.lastStatus;
      return j.enabled !== false && !!s && s !== 'ok' && s !== 'running';
    }).length;
    const disabled = jobs.filter(j => j.enabled === false).length;
    return { total, errors, disabled };
  }, [jobs]);

  // Group jobs by category
  const grouped = useMemo(() => {
    const map = new Map<Category, CronJob[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const job of jobs) {
      const cat = resolveCategory(job.agentId);
      map.get(cat)!.push(job);
    }
    return map;
  }, [jobs]);

  const refreshTemplates = async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/cron/templates');
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || 'Failed to load templates'));
      setTemplates(Array.isArray(payload?.templates) ? payload.templates : []);
    } catch (e) {
      toast.error((e as Error).message || 'Failed to load templates');
    } finally {
      setTemplatesLoading(false);
    }
  };

  useEffect(() => {
    if (!editOpen) return;
    refreshTemplates();
  }, [editOpen]);

  useEffect(() => {
    const fresh = data?.jobs;
    if (!fresh) return;
    setOptimisticEnabled((m) => {
      if (Object.keys(m).length === 0) return m;
      let changed = false;
      const next = { ...m };
      for (const job of fresh) {
        if (job.id in next && (job.enabled !== false) === next[job.id]) {
          delete next[job.id];
          changed = true;
        }
      }
      return changed ? next : m;
    });
  }, [data?.jobs]);

  const runAction = async (id: string, action: 'toggle' | 'trigger') => {
    setPending((p) => ({ ...p, [id]: true }));
    let applied = false;
    if (action === 'toggle') {
      const current = jobs.find((j) => j.id === id);
      const nextEnabled = current?.enabled === false;
      setOptimisticEnabled((m) => ({ ...m, [id]: nextEnabled }));
      applied = true;
    }
    try {
      const res = await fetch('/api/cron', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action }),
      });
      if (!res.ok) throw new Error('Request failed');
      toast.success(action === 'trigger' ? 'Cron triggered' : 'Cron toggled');
      setRefreshKey((k) => k + 1);
    } catch {
      if (applied) {
        setOptimisticEnabled((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
      }
      toast.error('Cron action failed');
    } finally {
      setPending((p) => ({ ...p, [id]: false }));
    }
  };

  const openCreate = () => {
    setEditError(null);
    setEditMode('create');
    setEditJobId(null);
    setTemplateId('');
    setNlPrompt('');
    setEditJson(JSON.stringify({
      id: 'competitor-watch',
      name: 'Competitor watchlist (daily)',
      agentId: 'reel-analyst',
      enabled: true,
      schedule: { expr: '0 9 * * *', tz: 'America/New_York' },
      payload: {
        kind: 'watchlist',
        message: 'Sweep the competitor watchlist: fetch each due competitor\'s recent reels and analyze the top new performer(s).',
        saveToKb: false,
      },
      skill: 'research',
    }, null, 2));
    setEditOpen(true);
  };

  const openEdit = (job: CronJob) => {
    setEditError(null);
    setEditMode('edit');
    setEditJobId(job.id);
    setTemplateId('');
    setNlPrompt('');
    const rest: Record<string, unknown> = { ...job };
    delete rest.lastRun;
    delete rest.lastResult;
    setEditJson(JSON.stringify(rest, null, 2));
    setEditOpen(true);
  };

  const loadTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    setEditError(null);
    setTemplateId(id);
    setEditJson(t.job_json);
  };

  const generateFromNl = async () => {
    const prompt = nlPrompt.trim();
    if (!prompt || nlBusy) return;
    setNlBusy(true);
    setEditError(null);
    try {
      const res = await fetch('/api/cron/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(payload?.error || 'Could not generate a job'));
      setEditJson(JSON.stringify(payload.job, null, 2));
      toast.success('Draft ready — review and Save');
    } catch (e) {
      setEditError((e as Error).message || 'Could not generate a job');
    } finally {
      setNlBusy(false);
    }
  };

  const saveTemplateFromEditor = async () => {
    setEditError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(editJson);
    } catch {
      setEditError('Invalid JSON (cannot save as template)');
      return;
    }
    const name = window.prompt('Template name?');
    if (!name) return;
    const description = window.prompt('Template description? (optional)') || '';

    try {
      const res = await fetch('/api/cron/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, job: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Template save failed'));
      toast.success('Template saved');
      await refreshTemplates();
    } catch (e) {
      toast.error((e as Error).message || 'Template save failed');
    }
  };

  const saveEdit = async () => {
    setEditBusy(true);
    setEditError(null);
    try {
      let parsed: unknown;
      try {
        parsed = JSON.parse(editJson);
      } catch {
        throw new Error('Invalid JSON');
      }
      if (!parsed || typeof parsed !== 'object') {
        throw new Error('Job must be an object');
      }

      const res = await fetch('/api/cron/jobs', {
        method: editMode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: parsed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(String(data?.error || 'Save failed'));
      }
      toast.success(editMode === 'create' ? 'Cron created' : 'Cron updated');
      setEditOpen(false);
      setRefreshKey((k) => k + 1);
    } catch (e) {
      setEditError((e as Error).message || 'Save failed');
    } finally {
      setEditBusy(false);
    }
  };

  const deleteJob = async (id: string) => {
    const ok = window.confirm(`Delete cron job "${id}"?`);
    if (!ok) return;
    try {
      const res = await fetch(`/api/cron/jobs?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(String(data?.error || 'Delete failed'));
      toast.success('Cron deleted');
      setRefreshKey((k) => k + 1);
    } catch (e) {
      toast.error((e as Error).message || 'Delete failed');
    }
  };

  const toggleRuns = async (id: string) => {
    const open = !openRuns[id];
    setOpenRuns((p) => ({ ...p, [id]: open }));
    if (open && !runs[id]) {
      try {
        const res = await fetch(`/api/cron/runs?id=${encodeURIComponent(id)}`);
        const data = await res.json();
        setRuns((p) => ({ ...p, [id]: data.runs || [] }));
      } catch {
        toast.error('Failed to load runs');
      }
    }
  };

  const wrapperClass = variant === 'page' ? 'space-y-4 animate-in' : 'panel';

  // ── Render a single job row ───────────────────────────────────────────────

  function JobRow({ job }: { job: CronJob }) {
    const lastStatus = job.state?.lastStatus;
    const running = lastStatus === 'running';
    const ok = lastStatus === 'ok';
    const isError = (!!lastStatus && !ok && !running) || !!job.state?.lastError;
    const statusClass = running
      ? 'status-pill status-neutral'
      : ok
        ? 'status-pill status-ok'
        : isError
          ? 'status-pill status-danger'
          : 'status-pill status-neutral';
    const statusLabel = running ? 'running…' : (lastStatus || 'idle');
    const busy = !!pending[job.id];
    const isDisabled = job.enabled === false;
    const runList = runs[job.id] || [];
    const expr = job.schedule?.expr ?? '';
    const tz = job.schedule?.tz;
    const humanSchedule = expr ? cronToHuman(expr, tz) : '—';
    const scheduleIsRaw = humanSchedule === expr && !!expr;

    return (
      <>
        {/* Main row */}
        <div
          className="grid items-center gap-x-3 px-3 hover:bg-[color-mix(in_srgb,var(--muted)_40%,transparent)] transition-colors"
          style={{
            gridTemplateColumns: '2.5rem 1fr 14rem 10rem 6rem',
            minHeight: '44px',
            transitionProperty: 'background-color',
            transitionDuration: 'var(--t-press)',
            transitionTimingFunction: 'var(--ease-out)',
          }}
        >
          {/* Toggle */}
          <div className="flex items-center justify-center">
            <button
              type="button"
              onClick={() => runAction(job.id, 'toggle')}
              disabled={busy}
              aria-label={isDisabled ? 'Enable cron job' : 'Disable cron job'}
              className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] disabled:cursor-not-allowed"
              style={{
                backgroundColor: isDisabled
                  ? 'color-mix(in srgb, var(--border) 80%, transparent)'
                  : 'var(--primary)',
                transitionProperty: 'background-color',
                transitionDuration: 'var(--t-press)',
                transitionTimingFunction: 'var(--ease-out)',
              }}
            >
              <span
                className="pointer-events-none block h-4 w-4 rounded-full bg-white shadow-sm"
                style={{
                  transform: isDisabled ? 'translateX(0)' : 'translateX(1rem)',
                  transitionProperty: 'transform',
                  transitionDuration: 'var(--t-press)',
                  transitionTimingFunction: 'var(--ease-out)',
                }}
              />
            </button>
          </div>

          {/* Name + agent */}
          <div className="min-w-0 py-1">
            <div className="text-xs font-medium truncate leading-tight">{job.name || job.id}</div>
            {job.agentId && (
              <div className="text-[10px] text-muted-foreground truncate leading-tight">{job.agentId}{job.skill ? ` · ${job.skill}` : ''}</div>
            )}
          </div>

          {/* Human schedule */}
          <div className="text-xs text-muted-foreground truncate" title={scheduleIsRaw ? expr : `${expr}${tz ? ` (${tz})` : ''}`}>
            {scheduleIsRaw
              ? <span className="font-mono text-[10px]">{expr}</span>
              : humanSchedule}
          </div>

          {/* Next run / status */}
          <div className="text-[10px] text-muted-foreground truncate">
            {job.state?.nextRunAtMs
              ? formatTime(job.state.nextRunAtMs)
              : <span className={statusClass}>{statusLabel}</span>}
          </div>

          {/* Actions */}
          <div className="flex items-center gap-0.5 justify-end">
            <button
              type="button"
              className="btn btn-ghost btn-sm text-[10px] px-1.5"
              onClick={() => runAction(job.id, 'trigger')}
              disabled={busy}
              title="Run now"
              aria-label="Run now"
            >
              <RotateCcw size={11} />
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-[10px] px-1.5"
              onClick={() => toggleRuns(job.id)}
              title="Run history"
              aria-label="Run history"
            >
              <History size={11} />
            </button>
            {canWrite && (
              <>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-[10px] px-1.5"
                  onClick={() => openEdit(job)}
                  aria-label="Edit cron job"
                  title="Edit"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-[10px] px-1.5 text-destructive"
                  onClick={() => deleteJob(job.id)}
                  aria-label="Delete cron job"
                  title="Delete"
                >
                  <Trash2 size={11} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Status/error drilldown (inline below the row) */}
        {isError && (
          <div className="mx-3 mb-1 bg-destructive/10 border border-destructive/30 rounded-md p-2 text-[11px] space-y-1">
            <span className="text-destructive font-medium">Error · </span>
            <span className="text-muted-foreground font-mono">{job.state?.lastStatus || 'unknown'}</span>
            {job.state?.lastError && <div className="text-destructive">{job.state.lastError}</div>}
          </div>
        )}

        {/* Run history drawer */}
        {openRuns[job.id] && (
          <div className="mx-3 mb-2 bg-muted/20 border border-border/40 rounded-md p-3 text-xs space-y-2">
            {runList.length === 0 ? (
              <div className="text-muted-foreground">No recent runs</div>
            ) : (
              runList.map((r, idx) => (
                <div key={idx} className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-mono text-[10px]">{formatRunTs(r.ts)}</div>
                    {r.summary && (
                      <div className="text-[11px] text-muted-foreground line-clamp-2">{r.summary}</div>
                    )}
                    {r.error && (
                      <div className="text-[11px] text-destructive">{r.error}</div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <div className={r.status === 'ok' ? 'status-pill status-ok' : 'status-pill status-danger'}>{r.status || 'unknown'}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">
                      {r.durationMs ? `${Math.round(r.durationMs / 1000)}s` : '—'}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </>
    );
  }

  // ── Category section ─────────────────────────────────────────────────────

  function CategorySection({ category, catJobs }: { category: Category; catJobs: CronJob[] }) {
    return (
      <div>
        {/* Section header */}
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{category}</span>
          <span className="text-[10px] text-muted-foreground">({catJobs.length})</span>
        </div>

        {/* Column header row */}
        <div
          className="grid gap-x-3 px-3 pb-1 border-b border-border/60"
          style={{ gridTemplateColumns: '2.5rem 1fr 14rem 10rem 6rem' }}
        >
          <div />
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Job</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Schedule</div>
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">Next run</div>
          <div />
        </div>

        {/* Job rows */}
        <div className="divide-y divide-border/40">
          {catJobs.map((job) => <JobRow key={job.id} job={job} />)}
        </div>
      </div>
    );
  }

  return (
    <div className={wrapperClass}>
      {/* Modal editor */}
      {editOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/40"
            onClick={() => setEditOpen(false)}
          />
          <div className="panel modal-surface relative w-full max-w-3xl" role="dialog" aria-modal="true" aria-labelledby="cron-edit-title">
            <div className="panel-header flex items-center justify-between gap-3">
              <div>
                <h2 id="cron-edit-title" className="text-sm font-medium">
                  {editMode === 'create' ? 'Add Cron Job' : `Edit Cron Job${editJobId ? `: ${editJobId}` : ''}`}
                </h2>
                <div className="text-[10px] text-muted-foreground mt-1">
                  <code>agentId</code> (a KeyPlayer sub-agent), <code>schedule.expr</code> (5-field cron) + <code>tz</code>, <code>payload.message</code> (the task). Results save to the knowledge base by default (<code>payload.saveToKb</code>/<code>kbDoc</code>) so the email + sales agents can reuse them. Runs on the hourly dispatcher.
                </div>
              </div>
              <button type="button" aria-label="Close cron editor" onClick={() => setEditOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="panel-body space-y-3">
              {editError && (
                <div className="text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md p-2">
                  {editError}
                </div>
              )}

              {/* NL generate */}
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <label className="text-[11px] font-medium flex items-center gap-1.5">
                  <Wand2 size={13} className="text-primary" /> Describe it in plain English
                </label>
                <textarea
                  className="w-full input text-xs min-h-[58px]"
                  placeholder="e.g. Every weekday at 8am, scan competitors' Meta ads and new content and summarize the key moves for the sales team."
                  value={nlPrompt}
                  onChange={(e) => setNlPrompt(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); generateFromNl(); } }}
                  aria-label="Describe the cron job in plain English"
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] text-muted-foreground">KeyPlayer fills in the schedule, agent, and task below — review before you save.</span>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm text-xs"
                    onClick={generateFromNl}
                    disabled={nlBusy || !nlPrompt.trim()}
                  >
                    {nlBusy ? 'Generating…' : (<><Wand2 size={12} /> Generate</>)}
                  </button>
                </div>
              </div>

              {/* Templates */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-wide">Templates</label>
                  <select
                    className="input text-xs"
                    value={templateId}
                    onChange={(e) => loadTemplate(e.target.value)}
                    disabled={templatesLoading}
                    aria-label="Load cron template"
                  >
                    <option value="">Load template…</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {templatesLoading && (
                    <span className="text-[10px] text-muted-foreground">Loading…</span>
                  )}
                </div>
                {canTemplatesWrite && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm text-xs"
                    onClick={saveTemplateFromEditor}
                    disabled={editBusy}
                    aria-label="Save cron template"
                  >
                    <BookmarkPlus size={12} /> Save as template
                  </button>
                )}
              </div>

              {/* Schedule preset chips + live preview */}
              <div className="space-y-1.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Schedule</div>
                <ScheduleEditor
                  value={editorScheduleExpr}
                  tz={(() => {
                    try { return (JSON.parse(editJson) as { schedule?: { tz?: string } })?.schedule?.tz; } catch { return undefined; }
                  })()}
                  onChange={(expr) => {
                    try {
                      const parsed = JSON.parse(editJson) as Record<string, unknown>;
                      const sched = (parsed.schedule as Record<string, unknown>) ?? {};
                      parsed.schedule = { ...sched, expr };
                      setEditJson(JSON.stringify(parsed, null, 2));
                    } catch {
                      // If JSON is invalid, just let the textarea reflect changes naturally
                    }
                  }}
                />
              </div>

              {/* Raw JSON editor */}
              <textarea
                className="w-full min-h-[28vh] input font-mono text-xs leading-relaxed"
                value={editJson}
                onChange={(e) => setEditJson(e.target.value)}
                aria-label="Cron job JSON editor"
              />
              <div className="flex items-center justify-end gap-2">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditOpen(false)} disabled={editBusy}>Cancel</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={saveEdit} disabled={editBusy}>
                  {editBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className={variant === 'page' ? 'panel' : 'panel-header'}>
        <div className={variant === 'page' ? 'panel-header flex items-center justify-between flex-wrap gap-3' : 'flex items-center justify-between flex-wrap gap-3'}>
          <div>
            <h2 className={variant === 'page' ? 'text-xl font-semibold' : 'text-sm font-medium'}>Cron Jobs</h2>
            {variant === 'page' && (
              <p className="text-sm text-muted-foreground">Schedule recurring KeyPlayer sub-agent tasks. The dispatcher runs due jobs hourly.</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="status-pill status-neutral">Total: {summary.total}</span>
            <span className={summary.errors > 0 ? 'status-pill status-danger' : 'status-pill status-ok'}>
              Errors: {summary.errors}
            </span>
            <span className="status-pill status-warn">Disabled: {summary.disabled}</span>
            {canWrite && (
              <button type="button" className="btn btn-sm text-xs" onClick={openCreate}>
                <Plus size={12} /> Add
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Job table, grouped by category */}
      <div className="panel overflow-hidden">
        {loading && jobs.length === 0 ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={`sk-${i}`} className="flex items-center gap-3">
                <Skeleton className="h-5 w-9 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-3 w-40" />
                  <Skeleton className="h-2.5 w-24" />
                </div>
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-5 w-16 rounded-md" />
              </div>
            ))}
          </div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No cron jobs yet.</div>
        ) : (
          <div className="divide-y divide-border/40">
            {CATEGORY_ORDER.map((cat) => {
              const catJobs = grouped.get(cat) ?? [];
              if (catJobs.length === 0) return null;
              return <CategorySection key={cat} category={cat} catJobs={catJobs} />;
            })}
          </div>
        )}
      </div>
    </div>
  );
}
