'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Clapperboard, Captions, Loader2, Save, Check, Telescope, Lightbulb,
  ExternalLink, FileText,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { Teleprompter } from '@/components/scripts/teleprompter';
import type { DraftRow } from '@/lib/drafts';

// Script Studio — the writing/recording surface for reel scripts. Scripts are
// drafts (type 'content_post', reel-format) authored by the ideator/competitor
// flows; here you edit the script text and run it through the teleprompter.
//
//   LEFT  — every reel script (newest first), polled ~30s. Click selects one.
//   RIGHT — the editor: title + monospace script textarea + Save → PATCH, plus a
//           Teleprompter button that opens the overlay with the CURRENT edited text.
//
// Data flows over the REST contract: GET /api/scripts (list), GET /api/scripts/[id]
// (full payload), PATCH /api/scripts/[id] { payload?, title? }.

interface ScriptsPayload { scripts: DraftRow[] }
interface ScriptPayload { script: DraftRow }

// Which flow authored the script — drives the small source badge.
function scriptSource(d: DraftRow): 'idea' | 'competitor' | null {
  const src = (d.metadata?.source as string | undefined) ?? '';
  if (src === 'reel-ideator') return 'idea';
  if (src === 'reel-intel') return 'competitor';
  return null;
}

export default function ScriptsPage() {
  const { data, loading, refetch } = useSmartPoll<ScriptsPayload>(
    () => fetch('/api/scripts', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 30_000 },
  );

  const scripts = useMemo(() => data?.scripts ?? [], [data?.scripts]);

  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Default the selection to the newest script once the list lands.
  useEffect(() => {
    if (selectedId == null && scripts.length > 0) setSelectedId(scripts[0].id);
  }, [scripts, selectedId]);

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<Clapperboard size={18} />}
        title="Script Studio"
        subtitle="Edit your reel scripts and run them through the teleprompter to record. Scripts come from Content Lab ideas and competitor reel teardowns."
      />

      <ContentTabs />

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        <ScriptList
          scripts={scripts}
          loading={loading}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <ScriptEditor
          key={selectedId ?? 'none'}
          id={selectedId}
          onSaved={refetch}
        />
      </div>
    </div>
  );
}

// ─── Left column — script list ────────────────────────────────────────────────

function ScriptList({
  scripts, loading, selectedId, onSelect,
}: {
  scripts: DraftRow[];
  loading: boolean;
  selectedId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-h2 flex items-center gap-2">
          <Captions size={15} className="text-primary" /> Scripts
        </h2>
        <span className="badge badge-neutral text-[11px]">{scripts.length}</span>
      </div>
      <div className="panel-body !p-2">
        {loading && scripts.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-small py-8">
            <Loader2 size={14} className="animate-spin" /> Loading scripts…
          </div>
        ) : scripts.length === 0 ? (
          <p className="text-small text-muted-foreground py-6 px-2 text-center leading-relaxed">
            No scripts yet — keep an idea in Content Lab and hit{' '}
            <span className="text-foreground font-medium">Write script</span>, or generate one
            from a competitor reel.
          </p>
        ) : (
          <ul className="space-y-1">
            {scripts.map((s) => (
              <ScriptRow
                key={s.id}
                script={s}
                active={s.id === selectedId}
                onSelect={() => onSelect(s.id)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ScriptRow({
  script, active, onSelect,
}: {
  script: DraftRow;
  active: boolean;
  onSelect: () => void;
}) {
  const source = scriptSource(script);
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left rounded-lg border px-2.5 py-2 space-y-1.5"
        style={{
          borderColor: active ? 'var(--primary)' : 'color-mix(in srgb, var(--border) 60%, transparent)',
          background: active
            ? 'color-mix(in srgb, var(--primary) 10%, transparent)'
            : 'color-mix(in srgb, var(--surface-2) 50%, transparent)',
          transition: 'border-color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out)',
        }}
      >
        <p className="text-sm font-medium leading-snug line-clamp-2 text-foreground">
          {script.title || 'Untitled script'}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          {source === 'idea' && (
            <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
              <Lightbulb size={9} /> Idea
            </span>
          )}
          {source === 'competitor' && (
            <span className="badge badge-neutral text-[10px] inline-flex items-center gap-1">
              <Telescope size={9} /> Competitor
            </span>
          )}
          <StatusBadge status={script.status} />
          <span className="text-micro text-muted-foreground ml-auto">{relTime(script.created_at)}</span>
        </div>
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'approved' || status === 'published' || status === 'sent'
      ? 'badge-success'
      : status === 'rejected' || status === 'expired'
        ? 'badge-neutral'
        : 'badge-neutral';
  return <span className={`badge ${cls} text-[10px] capitalize`}>{status}</span>;
}

// ─── Right column — editor ────────────────────────────────────────────────────

function ScriptEditor({ id, onSaved }: { id: number | null; onSaved: () => Promise<unknown> }) {
  const [script, setScript] = useState<DraftRow | null>(null);
  const [title, setTitle] = useState('');
  const [payload, setPayload] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [teleprompter, setTeleprompter] = useState(false);

  // Load the full script (payload) whenever the selected id changes.
  useEffect(() => {
    if (id == null) { setScript(null); return; }
    let cancel = false;
    setLoading(true);
    setError(null);
    fetch(`/api/scripts/${id}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.json() as Promise<ScriptPayload>;
      })
      .then((j) => {
        if (cancel) return;
        setScript(j.script);
        setTitle(j.script.title ?? '');
        setPayload(j.script.payload ?? '');
      })
      .catch((e) => { if (!cancel) setError((e as Error).message); })
      .finally(() => { if (!cancel) setLoading(false); });
    return () => { cancel = true; };
  }, [id]);

  const dirty = script != null && (title !== (script.title ?? '') || payload !== (script.payload ?? ''));

  const save = useCallback(async () => {
    if (id == null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/scripts/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload, title }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Save failed (${res.status})`);
      }
      const j = (await res.json()) as ScriptPayload;
      setScript(j.script);
      setTitle(j.script.title ?? '');
      setPayload(j.script.payload ?? '');
      setSavedAt(Date.now());
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [id, payload, title, onSaved]);

  // Clear the "Saved" flash once the user edits again.
  useEffect(() => { if (dirty) setSavedAt(null); }, [dirty]);

  if (id == null) {
    return (
      <section className="panel">
        <div className="panel-body p-12 text-center text-small text-muted-foreground">
          Select a script to edit.
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <h2 className="text-h2 flex items-center gap-2">
          <FileText size={15} className="text-primary" /> Editor
        </h2>
        <div className="flex items-center gap-2">
          <a
            href="/drafts"
            className="text-micro text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            style={{ transition: 'color var(--t-press) var(--ease-out)' }}
            title="Open in Drafts to approve / publish"
          >
            Open in Drafts <ExternalLink size={11} className="opacity-60" />
          </a>
        </div>
      </div>

      <div className="panel-body space-y-3">
        {loading && !script ? (
          <div className="flex items-center justify-center gap-2 text-small py-10">
            <Loader2 size={14} className="animate-spin" /> Loading script…
          </div>
        ) : (
          <>
            {/* Title */}
            <div className="space-y-1">
              <label className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Script title"
                className="input w-full"
                aria-label="Script title"
              />
            </div>

            {/* Script text */}
            <div className="space-y-1">
              <label className="text-micro uppercase tracking-wider text-muted-foreground/70 font-semibold">Script</label>
              <textarea
                value={payload}
                onChange={(e) => setPayload(e.target.value)}
                placeholder="Write your reel script here…"
                className="input w-full font-mono text-sm leading-relaxed resize-y"
                style={{ minHeight: 460 }}
                aria-label="Script text"
                spellCheck
              />
            </div>

            {error && (
              <p className="text-micro text-destructive">{error}</p>
            )}

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap pt-0.5">
              <button
                type="button"
                onClick={() => setTeleprompter(true)}
                className="btn btn-primary btn-sm"
                disabled={!payload.trim()}
                title="Open the auto-scrolling teleprompter with the current text"
              >
                <Captions size={14} /> Teleprompter
              </button>
              <button
                type="button"
                onClick={save}
                disabled={saving || !dirty}
                className="btn btn-ghost btn-sm"
              >
                {saving
                  ? <><Loader2 size={13} className="animate-spin" /> Saving…</>
                  : savedAt && !dirty
                    ? <><Check size={13} className="text-[var(--success,#22c55e)]" /> Saved</>
                    : <><Save size={13} /> Save</>}
              </button>
              {dirty && !saving && (
                <span className="text-micro text-muted-foreground">Unsaved changes</span>
              )}
            </div>
          </>
        )}
      </div>

      {teleprompter && (
        <Teleprompter text={payload} onClose={() => setTeleprompter(false)} />
      )}
    </section>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Drafts carry created_at as a Date in the type but an ISO string over JSON —
// accept either (and a unix-seconds number, defensively).
function relTime(input: DraftRow['created_at']): string {
  let ms: number;
  if (input instanceof Date) ms = input.getTime();
  else if (typeof input === 'number') ms = input < 1e12 ? input * 1000 : input;
  else ms = Date.parse(String(input));
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(1, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return `${Math.floor(s / (86400 * 30))}mo ago`;
}
