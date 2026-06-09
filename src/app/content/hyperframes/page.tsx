'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Film, Sparkles, Loader2, Copy, Check, ExternalLink, Save, Pencil, X, Wand2, Clapperboard, SlidersHorizontal,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { ContentTabs } from '@/components/content/content-tabs';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { toast } from '@/components/ui/toast';
import { parseStoryboard, type Storyboard } from '@/lib/hyperframes-storyboard';
import type { DraftRow } from '@/lib/drafts';

// Hyperframes hub (Phase 1) — the agent's script+storyboard output as a
// first-class, editable surface. Generate a storyboard from a brief, browse
// past ones, view them as scene cards, edit the source, and hand off to HeyGen.
// Rendering + one-click publish come in Phases 2–3 (see plans/hyperframes-hub.md).

interface ScriptsPayload { scripts: DraftRow[] }

const PLATFORMS = [
  { value: 'instagram', label: 'Reels' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'youtube_short', label: 'YT Short' },
];

export default function HyperframesPage() {
  const { data, loading, refetch } = useSmartPoll<ScriptsPayload>(
    () => fetch('/api/scripts', { cache: 'no-store' }).then((r) => r.json()),
    { interval: 30_000 },
  );
  const boards = useMemo(() => data?.scripts ?? [], [data?.scripts]);

  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    if (selectedId == null && boards.length > 0) setSelectedId(boards[0].id);
  }, [boards, selectedId]);
  const selected = boards.find((b) => b.id === selectedId) ?? null;

  // ── Generate ────────────────────────────────────────────────────────────
  const [brief, setBrief] = useState('');
  const [platform, setPlatform] = useState('instagram');
  const [length, setLength] = useState(30);
  const [generating, setGenerating] = useState(false);

  const generate = useCallback(async () => {
    if (!brief.trim() || generating) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/hyperframes/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief: brief.trim(), platform, length }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Generation failed');
      toast.success('Storyboard generated');
      setBrief('');
      await refetch();
      if (json.draft?.id) setSelectedId(json.draft.id);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }, [brief, platform, length, generating, refetch]);

  return (
    <div className="space-y-5 animate-in">
      <PageHeader
        icon={<Film size={18} />}
        title="Hyperframes"
        subtitle="Turn a brief into a short-form video script + storyboard, review it scene by scene, then hand it off to HeyGen to produce. In-app rendering + one-click publish are coming next."
      />

      <ContentTabs />

      {/* Generate */}
      <div className="panel">
        <div className="panel-body space-y-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Wand2 size={15} className="text-[var(--primary)]" />
            Generate a storyboard
          </div>
          <textarea
            value={brief}
            onChange={(e) => setBrief(e.target.value)}
            placeholder="What's the video about? e.g. '3 mistakes new founders make hiring their first sales rep' — hook-first, punchy."
            rows={2}
            className="w-full text-sm resize-y"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <select value={platform} onChange={(e) => setPlatform(e.target.value)} className="px-3 text-sm">
              {PLATFORMS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
            <select value={length} onChange={(e) => setLength(Number(e.target.value))} className="px-3 text-sm">
              {[15, 30, 45, 60].map((s) => <option key={s} value={s}>{s}s</option>)}
            </select>
            <button className="btn btn-primary btn-sm ml-auto" onClick={generate} disabled={generating || !brief.trim()}>
              {generating ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate</>}
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] items-start">
        <BoardList boards={boards} loading={loading} selectedId={selectedId} onSelect={setSelectedId} />
        {selected
          ? <StoryboardDetail key={selected.id} board={selected} onSaved={refetch} />
          : <div className="panel"><div className="panel-body text-sm text-muted-foreground">
              {loading ? 'Loading…' : 'No storyboards yet — generate one above, or create reel scripts from Ideas / Competitors.'}
            </div></div>}
      </div>
    </div>
  );
}

function BoardList({ boards, loading, selectedId, onSelect }: {
  boards: DraftRow[]; loading: boolean; selectedId: number | null; onSelect: (id: number) => void;
}) {
  return (
    <div className="panel">
      <div className="panel-header"><h3 className="section-title">Storyboards</h3></div>
      <div className="panel-body !p-0 max-h-[70vh] overflow-y-auto">
        {boards.length === 0 && (
          <div className="px-3 py-4 text-xs text-muted-foreground">{loading ? 'Loading…' : 'None yet.'}</div>
        )}
        {boards.map((b) => {
          const meta = (b.metadata ?? {}) as { platform?: string };
          const active = b.id === selectedId;
          return (
            <button
              key={b.id}
              onClick={() => onSelect(b.id)}
              className="w-full text-left px-3 py-2.5 border-b border-border/40"
              style={{
                background: active ? 'color-mix(in srgb, var(--primary) 10%, transparent)' : 'transparent',
                borderLeft: active ? '2px solid var(--primary)' : '2px solid transparent',
              }}
            >
              <div className="text-xs font-medium truncate">{b.title || `Storyboard #${b.id}`}</div>
              <div className="flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground">
                {meta.platform && <span className="font-mono uppercase">{meta.platform}</span>}
                <span>·</span>
                <span>{b.created_by ?? 'agent'}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StoryboardDetail({ board, onSaved }: { board: DraftRow; onSaved: () => void }) {
  const sb = useMemo<Storyboard>(() => parseStoryboard(board.payload), [board.payload]);

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(board.payload);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/scripts/${board.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payload: text }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      toast.success('Storyboard saved');
      setEditing(false);
      onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [board.id, text, onSaved]);

  const copy = useCallback(() => {
    const payload = sb.production?.hyperframesPrompt || board.payload;
    navigator.clipboard.writeText(payload);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }, [sb.production?.hyperframesPrompt, board.payload]);

  return (
    <div className="panel">
      <div className="panel-header flex items-center justify-between gap-2">
        <h3 className="section-title truncate">{board.title || `Storyboard #${board.id}`}</h3>
        <div className="flex items-center gap-1.5 shrink-0">
          <button className="btn btn-ghost btn-sm" onClick={copy} title="Copy the Hyperframes prompt (or full storyboard)">
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
          <a className="btn btn-ghost btn-sm" href="https://hyperframes.heygen.com" target="_blank" rel="noreferrer" title="Open HeyGen Hyperframes">
            <ExternalLink size={13} /> HeyGen
          </a>
          <Link className="btn btn-primary btn-sm" href={`/content/hyperframes/${board.id}`} title="Open the visual scene editor">
            <SlidersHorizontal size={13} /> Editor
          </Link>
          {editing ? (
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setText(board.payload); setEditing(false); }}><X size={13} /></button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
              </button>
            </>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => { setText(board.payload); setEditing(true); }}>
              <Pencil size={13} /> Edit
            </button>
          )}
        </div>
      </div>

      <div className="panel-body space-y-4">
        {editing ? (
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={24}
            className="w-full text-sm font-mono resize-y leading-relaxed" />
        ) : sb.parsed ? (
          <StoryboardView sb={sb} />
        ) : (
          <pre className="text-xs whitespace-pre-wrap font-mono text-muted-foreground">{board.payload}</pre>
        )}
      </div>
    </div>
  );
}

function StoryboardView({ sb }: { sb: Storyboard }) {
  return (
    <div className="space-y-4">
      {/* Meta chips */}
      <div className="flex items-center gap-2 flex-wrap text-[11px]">
        {sb.platform && <Chip label="Platform" value={sb.platform} />}
        {sb.length && <Chip label="Length" value={sb.length} />}
        {sb.aspect && <Chip label="Aspect" value={sb.aspect} />}
      </div>

      {/* Hook */}
      {sb.hook && (
        <SceneCard accent time="Hook" onScreenText={sb.hook.onScreenText} visual={sb.hook.visual} audio={sb.hook.audio} />
      )}

      {/* Scenes timeline */}
      {sb.scenes.length > 0 && (
        <div className="space-y-2">
          {sb.scenes.map((s, i) => (
            <SceneCard key={i} time={s.time} onScreenText={s.onScreenText} visual={s.visual} audio={s.audio} index={i + 1} />
          ))}
        </div>
      )}

      {/* CTA */}
      {sb.cta && (sb.cta.onScreenText || sb.cta.visual) && (
        <SceneCard accent time="CTA" onScreenText={sb.cta.onScreenText} visual={sb.cta.visual} />
      )}

      {/* Production notes */}
      {sb.production && (sb.production.music || sb.production.pacing || sb.production.broll || sb.production.hyperframesPrompt) && (
        <div className="rounded-lg border border-border/50 p-3 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-semibold"><Clapperboard size={13} className="text-[var(--primary)]" /> Production</div>
          {sb.production.music && <Note label="Music" value={sb.production.music} />}
          {sb.production.pacing && <Note label="Pacing" value={sb.production.pacing} />}
          {sb.production.broll && <Note label="B-roll" value={sb.production.broll} />}
          {sb.production.hyperframesPrompt && <Note label="Hyperframes prompt" value={sb.production.hyperframesPrompt} />}
        </div>
      )}

      {/* Risks */}
      {sb.risks && sb.risks.length > 0 && (
        <div className="rounded-lg border border-[var(--warning,#f59e0b)]/30 bg-[color-mix(in_srgb,var(--warning,#f59e0b)_8%,transparent)] p-3">
          <div className="text-xs font-semibold mb-1">Claims to verify</div>
          <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
            {sb.risks.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function SceneCard({ time, visual, onScreenText, audio, index, accent }: {
  time: string; visual?: string; onScreenText?: string; audio?: string; index?: number; accent?: boolean;
}) {
  return (
    <div
      className="rounded-lg border p-3 flex gap-3"
      style={{
        borderColor: accent ? 'color-mix(in srgb, var(--primary) 35%, transparent)' : 'var(--border)',
        background: accent ? 'color-mix(in srgb, var(--primary) 6%, transparent)' : 'transparent',
      }}
    >
      <div className="shrink-0 w-16 text-[10px] font-mono text-muted-foreground pt-0.5">
        {index != null && <div className="text-[var(--primary)] font-semibold mb-0.5">#{index}</div>}
        {time}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        {onScreenText && (
          <div className="text-sm font-medium">“{onScreenText}”</div>
        )}
        {visual && <Note label="Visual" value={visual} />}
        {audio && <Note label="Audio" value={audio} />}
      </div>
    </div>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border/60 px-2 py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </span>
  );
}

function Note({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs text-muted-foreground">
      <span className="uppercase tracking-wide text-[9px] text-muted-foreground/70 mr-1.5">{label}</span>
      <span className="text-foreground/90">{value}</span>
    </div>
  );
}
