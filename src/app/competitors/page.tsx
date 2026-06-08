'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Telescope, Loader2, Plus, Trash2, Link2, Sparkles, AlertCircle, Eye, RefreshCw, Upload,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import type { Competitor, ReelRow } from '@/lib/competitors';
import { ReelCard } from '@/components/competitors/reel-card';
import { WatchSeedBanner } from '@/components/competitors/watch-seed-banner';
import { LiveAnalysisBoard, isLiveReel } from '@/components/competitors/live-analysis-board';

// Competitor Intel surface. Three stacked sections:
//  1. Watchlist — handles we track on a daily/weekly cadence (add/toggle/remove).
//  2. Analyze a reel — paste any IG reel URL to tear it down on demand.
//  3. Reels grid — every watched/analyzed reel with metrics + "Why it won".
//
// All data flows through the REST contract (/api/competitors*). We poll the
// list every 20s so a running watchlist cron surfaces new reels live, and patch
// local state optimistically for snappy toggles.

type Schedule = 'daily' | 'weekly' | 'off';

interface CompetitorsPayload {
  competitors: Competitor[];
  reels: ReelRow[];
}

export default function CompetitorsPage() {
  // Poll fast while reels are mid-analysis so the Live Analysis Board advances in
  // real time; idle back to 20s when nothing is in flight.
  const [fast, setFast] = useState(false);
  const { data, loading, refetch } = useSmartPoll<CompetitorsPayload>(
    () => fetch('/api/competitors', { cache: 'no-store' }).then((r) => r.json()),
    { interval: fast ? 2_500 : 20_000 },
  );

  const competitors = data?.competitors ?? [];
  const reels = data?.reels ?? [];

  // Split reels into in-flight (Live board) vs settled (grid).
  const liveReels = useMemo(() => reels.filter((r) => isLiveReel(r.status)), [reels]);
  const doneReels = useMemo(() => reels.filter((r) => !isLiveReel(r.status)), [reels]);
  useEffect(() => { setFast(liveReels.length > 0); }, [liveReels.length]);

  // "Run watch now" — kick the watchlist sweep; it runs in the background, so we
  // just refetch to surface the first scraped reels and let the fast poll take over.
  const [sweeping, setSweeping] = useState(false);
  const runWatchNow = useCallback(async () => {
    setSweeping(true);
    try {
      await fetch('/api/competitors/cron', { method: 'POST' });
      await refetch();
    } finally {
      setSweeping(false);
    }
  }, [refetch]);

  // handle lookup so each reel card shows whose reel it is (ad-hoc pastes have
  // no competitor_id → fall back to the platform handle baked into nothing, so
  // we show "—"). Keyed on the raw payload array so the memo dep is stable.
  const handleById = useMemo(() => {
    const m = new Map<number, string>();
    for (const c of data?.competitors ?? []) m.set(c.id, c.display_name?.trim() || c.handle);
    return m;
  }, [data?.competitors]);

  // ── per-reel "generate script" state (re-analyze withScript) ────────────────
  const [scriptingId, setScriptingId] = useState<number | null>(null);
  const generateScript = useCallback(async (reel: ReelRow) => {
    setScriptingId(reel.id);
    try {
      await fetch('/api/competitors/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: reel.url, withScript: true }),
      });
      await refetch();
    } finally {
      setScriptingId(null);
    }
  }, [refetch]);

  // ── per-reel "re-analyze" (force a fresh scrape + teardown) ──────────────────
  const [reanalyzingId, setReanalyzingId] = useState<number | null>(null);
  const reanalyze = useCallback(async (reel: ReelRow) => {
    setReanalyzingId(reel.id);
    try {
      await fetch('/api/competitors/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: reel.url, force: true }),
      });
      await refetch();
    } finally {
      setReanalyzingId(null);
    }
  }, [refetch]);

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<Telescope size={18} />}
        title="Competitors"
        subtitle="Watch competitor handles, scrape their reels, and tear down why each one won — then turn the winners into your own scripts."
      />

      <ContentTabs />

      {/* One-click CTA to seed the daily watchlist cron — self-hides once seeded. */}
      <WatchSeedBanner />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <Watchlist competitors={competitors} loading={loading} onChange={refetch} />
        <AnalyzeBox onAnalyzed={refetch} />
      </div>

      {/* Live board — multiple reels being scraped/analyzed/scripted in real time. */}
      <LiveAnalysisBoard reels={liveReels} handleById={handleById} />

      <ReelsGrid
        reels={doneReels}
        onReanalyze={reanalyze}
        reanalyzingId={reanalyzingId}
        handleById={handleById}
        loading={loading}
        onGenerateScript={generateScript}
        scriptingId={scriptingId}
        onRunWatch={runWatchNow}
        sweeping={sweeping}
        hasCompetitors={competitors.length > 0}
      />
    </div>
  );
}

// ─── Watchlist ────────────────────────────────────────────────────────────────

function Watchlist({
  competitors, loading, onChange,
}: {
  competitors: Competitor[];
  loading: boolean;
  onChange: () => Promise<unknown>;
}) {
  const [handle, setHandle] = useState('');
  const [schedule, setSchedule] = useState<Schedule>('daily');
  const [adding, setAdding] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = useCallback(async () => {
    const h = handle.trim().replace(/^@/, '');
    if (!h) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch('/api/competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ handle: h, schedule }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      setHandle('');
      await onChange();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }, [handle, schedule, onChange]);

  const patch = useCallback(async (id: number, body: Record<string, unknown>) => {
    setBusyId(id);
    try {
      await fetch(`/api/competitors/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await onChange();
    } finally {
      setBusyId(null);
    }
  }, [onChange]);

  const remove = useCallback(async (id: number) => {
    setBusyId(id);
    try {
      await fetch(`/api/competitors/${id}`, { method: 'DELETE' });
      await onChange();
    } finally {
      setBusyId(null);
    }
  }, [onChange]);

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-h2 flex items-center gap-2"><Telescope size={15} className="text-primary" /> Watchlist</h2>
        <span className="badge badge-neutral text-[11px]">{competitors.length} tracked</span>
      </div>
      <div className="panel-body space-y-3">
        {/* Add form */}
        <form
          onSubmit={(e) => { e.preventDefault(); add(); }}
          className="flex items-center gap-2 flex-wrap"
        >
          <div className="relative flex-1 min-w-[160px]">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground text-sm pointer-events-none z-10">@</span>
            <input
              value={handle}
              onChange={(e) => setHandle(e.target.value)}
              placeholder="competitor_handle"
              className="input !pl-7"
              aria-label="Competitor handle"
            />
          </div>
          <select
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as Schedule)}
            aria-label="Check cadence"
            className="shrink-0"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="off">Paused</option>
          </select>
          <button type="submit" disabled={adding || !handle.trim()} className="btn btn-primary btn-sm shrink-0">
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Add
          </button>
        </form>
        {error && (
          <p className="text-micro text-destructive inline-flex items-center gap-1"><AlertCircle size={11} /> {error}</p>
        )}

        {/* List */}
        {loading && competitors.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-small py-6">
            <Loader2 size={14} className="animate-spin" /> Loading watchlist…
          </div>
        ) : competitors.length === 0 ? (
          <p className="text-small text-muted-foreground py-4 text-center">
            No competitors yet. Add a handle above to start tracking their reels.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {competitors.map((c) => {
              const busy = busyId === c.id;
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-2 rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] px-2.5 py-1.5"
                >
                  <div className="min-w-0 flex-1">
                    <a
                      href={`https://instagram.com/${c.handle}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium truncate inline-flex items-center gap-1 hover:text-[var(--primary)]"
                      style={{ transition: 'color var(--t-press) var(--ease-out)' }}
                    >
                      @{c.handle} <Link2 size={11} className="opacity-50" />
                    </a>
                    <div className="text-micro text-muted-foreground">
                      {c.last_checked_at ? `checked ${relTime(c.last_checked_at)}` : 'never checked'}
                    </div>
                  </div>

                  {/* cadence select doubles as the enable/pause control */}
                  <select
                    value={c.enabled ? c.schedule : 'off'}
                    disabled={busy}
                    onChange={(e) => {
                      const v = e.target.value as Schedule;
                      patch(c.id, v === 'off' ? { enabled: false } : { enabled: true, schedule: v });
                    }}
                    aria-label={`Cadence for ${c.handle}`}
                    className="btn-sm shrink-0 !min-h-[26px] text-[11px]"
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="off">Paused</option>
                  </select>

                  <button
                    type="button"
                    onClick={() => remove(c.id)}
                    disabled={busy}
                    title="Stop watching"
                    className="btn btn-ghost btn-sm shrink-0 !px-1.5"
                  >
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

// ─── Analyze a reel ───────────────────────────────────────────────────────────

const MAX_URLS = 10;
let urlRowSeq = 0;
const newUrlRow = () => ({ id: ++urlRowSeq, value: '' });

// Pull every Instagram reel/post permalink out of arbitrary text (a pasted list,
// a CSV column, etc.), deduped — powers paste-a-list + CSV import.
function extractReelUrls(text: string): string[] {
  const m = text.match(/https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_-]+/gi) || [];
  return Array.from(new Set(m.map((u) => u.replace(/\/$/, ''))));
}

function AnalyzeBox({ onAnalyzed }: { onAnalyzed: () => Promise<unknown> }) {
  // A small list of URL rows — "+" adds one (cap MAX_URLS), each row removable.
  const [rows, setRows] = useState<{ id: number; value: string }[]>(() => [newUrlRow()]);
  const [withScript, setWithScript] = useState(false);
  const [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setRowValue = useCallback((id: number, value: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, value } : r)));
  }, []);
  const addRow = useCallback(() => {
    setRows((rs) => (rs.length >= MAX_URLS ? rs : [...rs, newUrlRow()]));
  }, []);
  const removeRow = useCallback((id: number) => {
    setRows((rs) => (rs.length <= 1 ? [{ ...rs[0], value: '' }] : rs.filter((r) => r.id !== id)));
  }, []);

  // Bulk import — fill the rows from a list of links (CSV/txt upload or a paste of
  // many URLs). Takes up to MAX_URLS, notes if the list was longer.
  const fileRef = useRef<HTMLInputElement>(null);
  const importFromText = useCallback((text: string) => {
    const found = extractReelUrls(text);
    if (found.length === 0) { setError('No Instagram reel links found in that list.'); return; }
    setRows(found.slice(0, MAX_URLS).map((u) => ({ ...newUrlRow(), value: u })));
    setError(found.length > MAX_URLS ? `Imported the first ${MAX_URLS} of ${found.length} links.` : null);
  }, []);
  const onFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) { const r = new FileReader(); r.onload = () => importFromText(String(r.result || '')); r.readAsText(f); }
    e.target.value = ''; // allow re-importing the same file
  }, [importFromText]);
  // Splitting a multi-URL paste into rows — paste a whole list into any field.
  const onPasteRow = useCallback((e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (extractReelUrls(text).length > 1) { e.preventDefault(); importFromText(text); }
  }, [importFromText]);

  // Distinct non-empty URLs (trimmed, deduped) drive both the button label and submit.
  const urls = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of rows) {
      const u = r.value.trim();
      if (u && !seen.has(u)) { seen.add(u); out.push(u); }
    }
    return out;
  }, [rows]);

  const analyze = useCallback(async () => {
    if (urls.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      // ONE request → one Apify run scrapes the whole batch, then the server fans
      // the teardowns out concurrently. They all surface in the live board together.
      const res = await fetch('/api/competitors/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls, withScript, deep }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Failed (${res.status})`);
      }
      setRows([newUrlRow()]);
      await onAnalyzed();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [urls, withScript, deep, onAnalyzed]);

  const atCap = rows.length >= MAX_URLS;

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-h2 flex items-center gap-2"><Sparkles size={15} className="text-primary" /> Analyze reels</h2>
        <span className="text-micro text-muted-foreground">paste IG reel links</span>
      </div>
      <div className="panel-body space-y-3">
        <form onSubmit={(e) => { e.preventDefault(); analyze(); }} className="space-y-2.5">
          <div className="space-y-2">
            {rows.map((row, i) => (
              <div key={row.id} className="flex items-center gap-2">
                <div className="relative flex-1 min-w-0">
                  <Link2 size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                  <input
                    value={row.value}
                    onChange={(e) => setRowValue(row.id, e.target.value)}
                    onPaste={onPasteRow}
                    placeholder="https://www.instagram.com/reel/…"
                    className="input !pl-8"
                    aria-label={`Reel URL ${i + 1}`}
                    inputMode="url"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => removeRow(row.id)}
                  disabled={busy || (rows.length === 1 && !row.value.trim())}
                  title="Remove URL"
                  aria-label="Remove URL"
                  className="btn btn-ghost btn-sm shrink-0 !px-1.5"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={addRow}
              disabled={busy || atCap}
              className="btn btn-ghost btn-sm text-xs"
              title={atCap ? `Up to ${MAX_URLS} at once` : 'Add another reel URL'}
            >
              <Plus size={13} /> Add URL
            </button>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="btn btn-ghost btn-sm text-xs"
              title="Import a list of reel links from a .csv / .txt file (or just paste a whole list into a field)"
            >
              <Upload size={13} /> Import list
            </button>
            <input ref={fileRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={onFile} className="hidden" />
            <span className="text-micro text-muted-foreground">CSV/txt of links, or paste a whole list</span>
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap pt-0.5">
            <div className="flex items-center gap-4 flex-wrap">
              <label className="inline-flex items-center gap-2 text-small cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={withScript}
                  onChange={(e) => setWithScript(e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                Also write a script
              </label>
              <label
                className="inline-flex items-center gap-2 text-small cursor-pointer select-none"
                title="Adds live-trend research (Sonnet + web search). Costs more — off by default; the fast pass is a single cheap call."
              >
                <input
                  type="checkbox"
                  checked={deep}
                  onChange={(e) => setDeep(e.target.checked)}
                  className="accent-[var(--primary)]"
                />
                Deep analyze <span className="text-micro text-muted-foreground">(trend research)</span>
              </label>
            </div>
            <button type="submit" disabled={busy || urls.length === 0} className="btn btn-primary btn-sm">
              {busy ? (
                <><Loader2 size={13} className="animate-spin" /> Analyzing…</>
              ) : (
                <><Sparkles size={13} /> Analyze {urls.length || ''} reel{urls.length === 1 ? '' : 's'}</>
              )}
            </button>
          </div>
        </form>

        {error && (
          <p className="text-micro text-destructive inline-flex items-center gap-1"><AlertCircle size={11} /> {error}</p>
        )}

        {busy && (
          <div className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 text-small text-muted-foreground inline-flex items-center gap-2 w-full">
            <Loader2 size={14} className="animate-spin" /> Scraping {urls.length} reel{urls.length === 1 ? '' : 's'} and tearing {urls.length === 1 ? 'it' : 'them'} down…
          </div>
        )}

        {!busy && (
          <p className="text-micro text-muted-foreground">
            Analyzed reels appear in the live board above as they process, then settle into the grid below.
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Reels grid ───────────────────────────────────────────────────────────────

function ReelsGrid({
  reels, handleById, loading, onGenerateScript, scriptingId, onRunWatch, sweeping, hasCompetitors,
  onReanalyze, reanalyzingId,
}: {
  reels: ReelRow[];
  handleById: Map<number, string>;
  loading: boolean;
  onGenerateScript: (reel: ReelRow) => Promise<void>;
  scriptingId: number | null;
  onRunWatch: () => Promise<void>;
  sweeping: boolean;
  hasCompetitors: boolean;
  onReanalyze: (reel: ReelRow) => Promise<void>;
  reanalyzingId: number | null;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-h2 flex items-center gap-2"><Eye size={15} className="text-primary" /> Reels</h2>
          <p className="text-micro text-muted-foreground mt-0.5">Scraped from your watchlist + anything you analyzed by hand.</p>
        </div>
        <div className="flex items-center gap-2">
          {hasCompetitors && (
            <button
              type="button"
              onClick={onRunWatch}
              disabled={sweeping}
              className="btn btn-ghost btn-sm text-xs"
              title="Scrape every due competitor now and analyze their top new reels"
            >
              <RefreshCw size={13} className={sweeping ? 'animate-spin' : ''} /> {sweeping ? 'Sweeping…' : 'Run watch now'}
            </button>
          )}
          <span className="badge badge-neutral">{reels.length}</span>
        </div>
      </div>

      {loading && reels.length === 0 ? (
        <div className="panel p-10 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading reels…
        </div>
      ) : reels.length === 0 ? (
        <div className="panel p-10 text-center text-small text-muted-foreground">
          No reels yet. Add a competitor to your watchlist or analyze a reel above to get started.
        </div>
      ) : (
        // Auto-fill grid: cards pack as many per row as the section width allows
        // (5–7 on wide screens), so a full section needs fewer rows / less scroll.
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))' }}
        >
          {reels.map((r) => (
            <ReelCard
              key={r.id}
              reel={r}
              handle={reelHandle(r, handleById)}
              onGenerateScript={onGenerateScript}
              scripting={scriptingId === r.id}
              onReanalyze={onReanalyze}
              reanalyzing={reanalyzingId === r.id}
            />
          ))}
        </div>
      )}
    </section>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Whose reel is this? Prefer the tracked competitor's handle; for ad-hoc pastes
// (no competitor_id) fall back to the owner username captured at scrape time
// (analysis.handle). '—' only when we truly don't know.
function reelHandle(r: ReelRow, handleById: Map<number, string>): string {
  if (r.competitor_id != null) {
    const h = handleById.get(r.competitor_id);
    if (h && h !== '—') return h;
  }
  const a = r.analysis;
  if (a && typeof a === 'object') {
    const h = (a as Record<string, unknown>).handle;
    if (typeof h === 'string' && h.trim()) return h.trim().replace(/^@/, '');
  }
  // Last resort: a username in the permalink itself (instagram.com/<handle>/reel/…)
  const m = r.url.match(/instagram\.com\/([^/?#]+)\//i);
  if (m && m[1] && !/^(reel|reels|p|tv|stories|explore)$/i.test(m[1])) return m[1];
  return '—';
}

function relTime(sec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}
