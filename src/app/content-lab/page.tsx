'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  FlaskConical, Lightbulb, Loader2, Sparkles, Radar, Eye, AlertCircle, ExternalLink,
  Gauge, Target, Wand2, CheckCircle2,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { IdeaCard } from '@/components/content-lab/idea-card';
import { ReelReport, GOAL_META, GOAL_OPTIONS, type ScanGoal } from '@/components/content-lab/reel-report';
import { CleanSections } from '@/components/competitors/clean-sections';
import type { ReelScan } from '@/lib/reel-scans';

// Content Lab — the ideation surface of the content command center. Two stacked
// sections:
//   1. TREND RADAR — what's hot across the competitor reels we've analyzed
//      (top tags as colored chips, top reels as thumbnails, the Analyst's pulse).
//   2. TRIAL REEL GENERATOR — generate concept ideas on demand, then Keep /
//      Dismiss them and turn the keepers into draft scripts.
//
// Both read the competitors REST contract (/api/competitors/trends + /ideas).
// We poll the idea list every 10s so a generate run (which stores asynchronously)
// surfaces its concepts live.

// ── Shared contract shapes (mirrors trends.ts / reel-ideas.ts) ────────────────
// Typed structurally here so the page stays decoupled from the lib modules it
// integrates with purely over REST.
interface TrendTag { slug: string; label: string; color: string; count: number; reelIds: number[] }
interface TrendReel { id: number; url: string; thumbnail_url: string | null; caption: string | null; views: number | null; tags: string[] }
interface TrendRadar {
  windowDays: number;
  analyzedCount: number;
  topTags: TrendTag[];
  topReels: TrendReel[];
  pulse: string;
}

export interface ReelIdea {
  id: number;
  hook: string;
  angle: string;
  format: string;
  rationale: string;
  trend_tag: string | null;
  status: string;
  script_draft_id: number | null;
  created_at: number;
}

interface IdeasPayload { ideas: ReelIdea[] }

// ReelScan + GOAL_META live in their canonical homes (@/lib/reel-scans and the
// reel-report component) and are imported above — Next forbids re-exporting them
// from this page module.
interface ScansPayload { scans: ReelScan[] }

// proposed + kept stay up top (newest first); dismissed sinks to the bottom.
const STATUS_RANK: Record<string, number> = { proposed: 0, kept: 1, dismissed: 2 };

export default function ContentLabPage() {
  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<FlaskConical size={18} />}
        title="Content Lab"
        subtitle="See what's trending, scan your own reels for a full teardown + rewrites, then spin up trial reel concepts — keep the winners and turn them into scripts."
      />

      <ContentTabs />

      <TrendRadarSection />
      <OptimizeReelSection />
      <TrialGeneratorSection />
    </div>
  );
}

// ─── Optimize my reel (Tribe-v2 self-scan) ────────────────────────────────────

function OptimizeReelSection() {
  // Poll fast (~3s) while any scan is still 'scanning', else idle (~20s). The
  // interval feeds useSmartPoll, whose timer restarts when it changes — giving a
  // genuinely dynamic cadence without a second hook.
  const [anyScanning, setAnyScanning] = useState(false);
  const { data, loading, refetch } = useSmartPoll<ScansPayload>(
    () => fetch('/api/content-lab/scan', { cache: 'no-store' }).then((r) => r.json()),
    { interval: anyScanning ? 3_000 : 20_000 },
  );

  const scans = useMemo(() => data?.scans ?? [], [data?.scans]);

  // Keep the polling cadence in sync with whether anything is mid-scan.
  const scanning = scans.some((s) => s.status === 'scanning');
  if (scanning !== anyScanning) setAnyScanning(scanning);

  const [url, setUrl] = useState('');
  const [goal, setGoal] = useState<ScanGoal>('general');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Which scan is expanded in the report. null → newest scan (default).
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const submit = useCallback(async (overrideUrl?: string, overrideGoal?: string) => {
    const u = (overrideUrl ?? url).trim();
    if (!u) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/content-lab/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: u, goal: overrideGoal ?? goal }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      const j = (await res.json().catch(() => ({}))) as { scan?: ReelScan };
      if (!overrideUrl) setUrl('');
      if (j.scan) setSelectedId(j.scan.id);
      setAnyScanning(true); // flip to fast polling immediately
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [url, goal, refetch]);

  // Resolve the report subject: the explicitly selected scan, else the newest.
  const selected = useMemo(() => {
    if (selectedId != null) return scans.find((s) => s.id === selectedId) ?? scans[0] ?? null;
    return scans[0] ?? null;
  }, [scans, selectedId]);

  const [retryingId, setRetryingId] = useState<number | null>(null);
  const retry = useCallback(async (scan: ReelScan) => {
    setRetryingId(scan.id);
    try {
      await submit(scan.url, scan.goal);
    } finally {
      setRetryingId(null);
    }
  }, [submit]);

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-h2 flex items-center gap-2">
            <Gauge size={15} className="text-primary" /> Optimize my reel
          </h2>
          <p className="text-micro text-muted-foreground mt-0.5">
            Paste one of your own reels, pick a goal, and get a full teardown — scores, weak points, and rewrites.
          </p>
        </div>
        {scans.length > 0 && <span className="badge badge-neutral">{scans.length}</span>}
      </div>

      {/* Scan bar — url + goal select + scan button */}
      <div className="panel">
        <div className="panel-body">
          <form
            onSubmit={(e) => { e.preventDefault(); submit(); }}
            className="flex items-center gap-2 flex-wrap"
          >
            <div className="relative flex-1 min-w-[220px]">
              <Wand2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste your reel URL — https://instagram.com/reel/…"
                className="input !pl-8"
                aria-label="Reel URL"
                inputMode="url"
              />
            </div>
            <div className="relative shrink-0">
              <Target size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <select
                value={goal}
                onChange={(e) => setGoal(e.target.value as ScanGoal)}
                className="input !pl-8 pr-7 cursor-pointer"
                aria-label="Optimization goal"
              >
                {GOAL_OPTIONS.map((g) => (
                  <option key={g} value={g}>{GOAL_META[g].label}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={submitting || !url.trim()} className="btn btn-primary btn-sm shrink-0">
              {submitting
                ? <><Loader2 size={13} className="animate-spin" /> Scanning…</>
                : <><Gauge size={13} /> Scan</>}
            </button>
          </form>
          {error && (
            <p className="text-micro text-destructive inline-flex items-center gap-1 mt-2"><AlertCircle size={11} /> {error}</p>
          )}
        </div>
      </div>

      {/* Recent scans strip — click to load that scan into the report. */}
      {scans.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {scans.map((s) => (
            <ScanChip
              key={s.id}
              scan={s}
              active={selected?.id === s.id}
              onSelect={() => setSelectedId(s.id)}
            />
          ))}
        </div>
      )}

      {/* The active scan's full report. */}
      {loading && !data ? (
        <div className="panel p-10 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading scans…
        </div>
      ) : selected ? (
        <ReelReport
          scan={selected}
          onRetry={() => retry(selected)}
          retrying={retryingId === selected.id}
        />
      ) : (
        <div className="panel p-10 text-center text-small text-muted-foreground">
          Paste one of your own reels and pick a goal to get a full teardown + rewrites.
        </div>
      )}
    </section>
  );
}

// One recent scan as a compact selectable chip: thumbnail + goal badge + status.
function ScanChip({ scan, active, onSelect }: { scan: ReelScan; active: boolean; onSelect: () => void }) {
  const [failed, setFailed] = useState(false);
  const goal = GOAL_META[scan.goal] ?? GOAL_META.general;
  const showCover = !!scan.thumbnail_url && !failed;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={`${goal.label} · ${scan.status}`}
      className="group relative w-[72px] shrink-0 aspect-[4/5] rounded-lg overflow-hidden border bg-muted card-hover"
      style={{
        borderColor: active ? 'var(--primary)' : 'color-mix(in srgb, var(--border) 70%, transparent)',
        boxShadow: active ? '0 0 0 1px var(--primary)' : undefined,
      }}
    >
      {showCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/img-proxy?url=${encodeURIComponent(scan.thumbnail_url!)}`}
          alt="reel"
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="w-full h-full grid place-items-center text-white/70"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--surface-2)), var(--surface-2))' }}
        >
          {scan.status === 'scanning' ? <Loader2 size={16} className="animate-spin opacity-80" /> : <Eye size={16} className="opacity-70" />}
        </div>
      )}
      {/* goal dot */}
      <span
        className="absolute top-1 left-1 h-2 w-2 rounded-full ring-1 ring-black/30"
        style={{ background: goal.color }}
        aria-hidden="true"
      />
      {/* status footer */}
      <span className="absolute inset-x-0 bottom-0 px-1 py-0.5 text-[8px] font-medium text-white text-center bg-gradient-to-t from-black/75 to-transparent">
        {scan.status === 'scanning' ? 'scanning…' : scan.status === 'error' ? 'failed' : goal.label}
      </span>
    </button>
  );
}

// ─── 1. Trend Radar ───────────────────────────────────────────────────────────

function TrendRadarSection() {
  const { data, loading } = useSmartPoll<TrendRadar>(
    () => fetch('/api/competitors/trends', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 60_000 },
  );

  const analyzed = data?.analyzedCount ?? 0;
  const topTags = data?.topTags ?? [];
  const topReels = data?.topReels ?? [];
  const pulse = data?.pulse?.trim() ?? '';
  const isEmpty = !loading && analyzed === 0 && topTags.length === 0;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-h2 flex items-center gap-2">
          <Radar size={15} className="text-primary" /> Trend Radar
        </h2>
        <span className="text-micro text-muted-foreground">
          {analyzed > 0
            ? `${analyzed} reel${analyzed === 1 ? '' : 's'} analyzed${data?.windowDays ? ` · last ${data.windowDays}d` : ''}`
            : "what's hot"}
        </span>
      </div>

      <div className="panel-body space-y-4">
        {loading && !data ? (
          <div className="flex items-center justify-center gap-2 text-small py-8">
            <Loader2 size={14} className="animate-spin" /> Reading the radar…
          </div>
        ) : isEmpty ? (
          <p className="text-small text-muted-foreground py-6 text-center">
            Analyze a few competitor reels to light up the radar.
          </p>
        ) : (
          <>
            {/* What's hot — top tags as colored chips with counts */}
            {topTags.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">What&apos;s hot</p>
                <div className="flex flex-wrap items-center gap-1.5">
                  {topTags.map((t) => (
                    <span
                      key={t.slug}
                      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium leading-none border"
                      style={{
                        background: `color-mix(in srgb, ${t.color} 14%, transparent)`,
                        color: t.color,
                        borderColor: `color-mix(in srgb, ${t.color} 55%, transparent)`,
                      }}
                      title={`${t.count} reel${t.count === 1 ? '' : 's'} tagged ${t.label}`}
                    >
                      {t.label}
                      <span className="font-mono tabular-nums opacity-70">{t.count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Top reels — compact clickable thumbnail row */}
            {topReels.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">Top reels</p>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {topReels.map((reel) => (
                    <TrendThumb key={reel.id} reel={reel} />
                  ))}
                </div>
              </div>
            )}

            {/* Analyst pulse — rendered with the same clean breakdown as the
                "Why it won" popup (green headers, tidy bullets, no markdown cruft). */}
            {pulse && (
              <div className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-3">
                <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold inline-flex items-center gap-1.5 mb-2">
                  <Sparkles size={11} className="text-primary" /> What the Analyst is noticing
                </p>
                <CleanSections text={pulse} />
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function TrendThumb({ reel }: { reel: TrendReel }) {
  const [failed, setFailed] = useState(false);
  const showCover = !!reel.thumbnail_url && !failed;
  return (
    <a
      href={reel.url}
      target="_blank"
      rel="noreferrer"
      title={reel.caption ?? 'Open reel on Instagram'}
      className="group relative w-[88px] shrink-0 aspect-[4/5] rounded-lg overflow-hidden border border-border/50 bg-muted card-hover"
    >
      {showCover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/img-proxy?url=${encodeURIComponent(reel.thumbnail_url!)}`}
          alt={reel.caption ?? 'reel'}
          className="w-full h-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <div
          className="w-full h-full grid place-items-center text-white/70"
          style={{ background: 'linear-gradient(135deg, color-mix(in srgb, var(--primary) 22%, var(--surface-2)), var(--surface-2))' }}
        >
          <Eye size={18} className="opacity-70" />
        </div>
      )}
      <span
        className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-1 px-1.5 py-1 text-[9px] font-medium text-white bg-gradient-to-t from-black/75 to-transparent"
      >
        <span className="font-mono tabular-nums">{fmtViews(reel.views)}</span>
        <ExternalLink size={9} className="opacity-0 group-hover:opacity-100" style={{ transition: 'opacity var(--t-popover) var(--ease-out)' }} />
      </span>
    </a>
  );
}

// ─── 2. Trial Reel Generator ──────────────────────────────────────────────────

function TrialGeneratorSection() {
  const { data, loading, refetch } = useSmartPoll<IdeasPayload>(
    () => fetch('/api/competitors/ideas', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 10_000 },
  );

  const [focus, setFocus] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch('/api/competitors/ideas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ focus: focus.trim() || undefined }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      setFocus('');
      await refetch();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [focus, refetch]);

  // Optimistic local overrides so Keep/Dismiss/Write-script feel instant; the
  // 10s poll reconciles to the server truth.
  const [overrides, setOverrides] = useState<Record<number, Partial<ReelIdea>>>({});
  const applyOverride = useCallback((id: number, patch: Partial<ReelIdea>) => {
    setOverrides((o) => ({ ...o, [id]: { ...o[id], ...patch } }));
  }, []);

  const ideas = useMemo(() => {
    const merged = (data?.ideas ?? []).map((i) => ({ ...i, ...overrides[i.id] }));
    // proposed + kept first, dismissed last; newest within a bucket.
    return merged.slice().sort((a, b) => {
      const ra = STATUS_RANK[a.status] ?? 0;
      const rb = STATUS_RANK[b.status] ?? 0;
      if (ra !== rb) return ra - rb;
      return b.created_at - a.created_at;
    });
  }, [data?.ideas, overrides]);

  const setStatus = useCallback(async (id: number, status: 'kept' | 'dismissed') => {
    applyOverride(id, { status });
    try {
      await fetch(`/api/competitors/ideas/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      await refetch();
    } catch {
      // Roll the optimistic status back to what the server last reported.
      const prev = (data?.ideas ?? []).find((i) => i.id === id);
      if (prev) applyOverride(id, { status: prev.status });
    }
  }, [applyOverride, refetch, data?.ideas]);

  const [scriptingId, setScriptingId] = useState<number | null>(null);
  const writeScript = useCallback(async (id: number) => {
    setScriptingId(id);
    try {
      const res = await fetch(`/api/competitors/ideas/${id}/script`, { method: 'POST' });
      if (res.ok) {
        const j = await res.json().catch(() => ({})) as { idea?: ReelIdea };
        if (j.idea?.script_draft_id != null) applyOverride(id, { script_draft_id: j.idea.script_draft_id });
      }
      await refetch();
    } finally {
      setScriptingId(null);
    }
  }, [applyOverride, refetch]);

  const visible = ideas.filter((i) => i.status !== 'dismissed');
  const proposed = visible.filter((i) => i.status === 'proposed');
  const kept = visible.filter((i) => i.status === 'kept');
  const liveCount = visible.length;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-h2 flex items-center gap-2">
            <Lightbulb size={15} className="text-primary" /> Trial Reel Generator
          </h2>
          <p className="text-micro text-muted-foreground mt-0.5">
            Spin up concept ideas from current trends + competitor wins. Keep the strong ones, then write the script.
          </p>
        </div>
        <span className="badge badge-neutral">{liveCount}</span>
      </div>

      {/* Generate bar */}
      <div className="panel">
        <div className="panel-body">
          <form
            onSubmit={(e) => { e.preventDefault(); generate(); }}
            className="flex items-center gap-2 flex-wrap"
          >
            <div className="relative flex-1 min-w-[200px]">
              <Sparkles size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
              <input
                value={focus}
                onChange={(e) => setFocus(e.target.value)}
                placeholder="Optional focus — e.g. “founder POV hooks”, “product demos”…"
                className="input !pl-8"
                aria-label="Idea focus"
              />
            </div>
            <button type="submit" disabled={generating} className="btn btn-primary btn-sm shrink-0">
              {generating
                ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                : <><Lightbulb size={13} /> Generate ideas</>}
            </button>
          </form>
          {error && (
            <p className="text-micro text-destructive inline-flex items-center gap-1 mt-2"><AlertCircle size={11} /> {error}</p>
          )}
          {generating && (
            <p className="text-micro text-muted-foreground mt-2 inline-flex items-center gap-1.5">
              <Loader2 size={11} className="animate-spin" /> Gathering trends + competitor wins and drafting concepts…
            </p>
          )}
        </div>
      </div>

      {/* Idea cards */}
      {loading && !data ? (
        <div className="panel p-10 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading ideas…
        </div>
      ) : visible.length === 0 ? (
        <div className="panel p-10 text-center text-small text-muted-foreground">
          No concepts yet. Hit <span className="text-foreground font-medium">Generate ideas</span> to spin up a batch of trial reel angles.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Suggestions — fresh concepts to curate. */}
          {proposed.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">
                Suggestions · {proposed.length}
              </h3>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {proposed.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea}
                    onKeep={() => setStatus(idea.id, 'kept')}
                    onDismiss={() => setStatus(idea.id, 'dismissed')}
                    onWriteScript={() => writeScript(idea.id)}
                    scripting={scriptingId === idea.id} />
                ))}
              </div>
            </div>
          )}

          {/* Kept — where a "Keep" lands. Ready to turn into a script. */}
          {kept.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-micro uppercase tracking-wider font-semibold inline-flex items-center gap-1.5" style={{ color: 'var(--primary)' }}>
                <CheckCircle2 size={12} /> Kept · ready to script · {kept.length}
              </h3>
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
                {kept.map((idea) => (
                  <IdeaCard key={idea.id} idea={idea}
                    onKeep={() => setStatus(idea.id, 'kept')}
                    onDismiss={() => setStatus(idea.id, 'dismissed')}
                    onWriteScript={() => writeScript(idea.id)}
                    scripting={scriptingId === idea.id} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtViews(n: number | null): string {
  if (n == null) return '—';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
