'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, Type, ChevronUp, ChevronDown,
  AlignLeft, AlignCenter, AlignRight, ExternalLink, Film, Clapperboard, Play, Download, Upload, ImageIcon, Video,
  X, Hash, ListChecks, BarChart3, Send, Sparkles,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { parseStoryboard } from '@/lib/hyperframes-storyboard';
import {
  compositionFromStoryboard, isComposition, newScene, newTextLayer, formatMs, DEFAULT_ACCENT, SCENE_TRANSITIONS,
  type BrollOverlay, type CaptionStyle, type Composition, type CompositionScene, type Infographic, type SceneGeneration, type SceneTransition, type TextLayer,
} from '@/lib/hyperframes-composition';
import { Timeline, type TimelineSelection } from '@/components/hyperframes/timeline';
import type { DraftRow } from '@/lib/drafts';

interface RenderInfo {
  render_id?: string;
  status?: 'queued' | 'rendering' | 'completed' | 'failed' | 'unknown';
  video_url?: string | null;
  thumbnail_url?: string | null;
  error?: string | null;
}
const isActiveRender = (r: RenderInfo | null) => r?.status === 'queued' || r?.status === 'rendering';

// Visual scene editor (Phase 2a) — edit the video layer of a storyboard before
// rendering: position on-screen text on a live 9:16 frame, set the background /
// b-roll, tweak timing + VO. Saves the structured composition to the draft
// (metadata.composition). HeyGen rendering hooks onto this in Phase 2b.
//
// Rich format (Phase 2): per-scene transition + punch-in beats, b-roll overlay
// splices (full-bleed / inset PiP), stat/list/bar infographics (dragged on the
// frame exactly like text layers), and the composition-level caption style —
// all optional fields, all persisted through the same PATCH metadata.composition
// flow, so old compositions are untouched until the user adds something.

const CANVAS_W = 300;                 // px; 9:16 → height below
const CANVAS_H = Math.round((CANVAS_W * 16) / 9);
const FONT_SCALE = CANVAS_W / 1080;   // composition fontSize is at a 1080px reference

// Mirror of the renderer's image sniff (hyperframes-html) — image overlays
// preview for real on the canvas; video overlays get a labeled placeholder.
const IMG_URL = /\.(png|jpe?g|gif|webp|avif|svg)(\?|#|$)/i;
// Inset PiP geometry mirrors overlayClip() in hyperframes-html: 62% width,
// 16:9 box, anchored at 7% (top) or 52% (bottom) of the frame height.
const INSET_H_PCT = ((0.62 * 1080 * 9) / 16 / 1920) * 100;
const TRANSITION_LABELS: Record<SceneTransition, string> = { cut: 'Cut (hard)', punch_in: 'Punch-in', whip: 'Whip', pop: 'Pop' };

export default function HyperframesEditorPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [comp, setComp] = useState<Composition | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [selectedIg, setSelectedIg] = useState<number | null>(null); // index into the scene's infographics
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [render, setRender] = useState<RenderInfo | null>(null);
  const [rendering, setRendering] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [needsSeed, setNeedsSeed] = useState(false);
  const [autobuilding, setAutobuilding] = useState(false);
  const [viewMode, setViewMode] = useState<'simple' | 'timeline'>('simple');
  const [exportOpen, setExportOpen] = useState(false); // NLE export dropdown
  const [regenIdx, setRegenIdx] = useState<number | null>(null); // scene index currently regenerating its AI background

  // Publish panel state
  const [showPublish, setShowPublish] = useState(false);
  const [publishPlatform, setPublishPlatform] = useState<'youtube_video' | 'instagram_reel'>('youtube_video');
  const [publishTitle, setPublishTitle] = useState('');
  const [publishDesc, setPublishDesc] = useState('');
  const [publishCaption, setPublishCaption] = useState('');
  const [publishPrivacy, setPublishPrivacy] = useState<'public' | 'unlisted' | 'private'>('public');
  const [publishing, setPublishing] = useState(false);
  const [publishResult, setPublishResult] = useState<{ link: string | null; message: string } | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Load the draft. A saved composition opens directly; a first open offers the
  // agent auto-build (rich reel) vs the plain storyboard seed — see needsSeed.
  useEffect(() => {
    let cancel = false;
    fetch(`/api/hyperframes/${id}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (j.error || !j.draft) { setError(j.error || 'Not found'); return; }
        const d = j.draft as DraftRow;
        setDraft(d);
        const saved = (d.metadata as { composition?: unknown } | null)?.composition;
        if (isComposition(saved)) setComp(saved);
        else setNeedsSeed(true);
        const r = (d.metadata as { render?: RenderInfo } | null)?.render;
        if (r?.render_id) setRender(r);
      })
      .catch((e) => !cancel && setError((e as Error).message));
    return () => { cancel = true; };
  }, [id]);

  // First-open paths: the agent composes the rich reel server-side (persisted on
  // success; the seed fallback is NOT persisted so auto-build stays retryable),
  // or the user starts from today's plain storyboard seed.
  const autobuild = useCallback(async () => {
    setAutobuilding(true);
    try {
      const r = await fetch(`/api/hyperframes/${id}/autobuild`, { method: 'POST' });
      const j = await r.json();
      if (!r.ok) { toast.error(j.error || 'Auto-build failed'); return; }
      if (j.source === 'agent') { setComp(j.composition); setDirty(false); setNeedsSeed(false); }
      else if (j.source === 'seed') { setComp(j.composition); setDirty(true); setNeedsSeed(false); if (j.error) toast.error(j.error); }
      else if (j.source === 'existing') { setComp(j.composition); setNeedsSeed(false); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAutobuilding(false);
    }
  }, [id]);

  const plainSeed = useCallback(() => {
    if (!draft) return;
    setComp(compositionFromStoryboard(parseStoryboard(draft.payload)));
    setDirty(true);
    setNeedsSeed(false);
  }, [draft]);

  const scene: CompositionScene | undefined = comp?.scenes[sceneIdx];
  const selectedLayer = scene?.layers.find((l) => l.id === selectedLayerId) ?? null;
  const selectedInfographic = selectedIg !== null ? scene?.infographics?.[selectedIg] ?? null : null;
  // Caption-style accent also colors infographics — keep the canvas truthful.
  const accent = comp?.caption_style?.accent_color || DEFAULT_ACCENT;

  // ── immutable updates ─────────────────────────────────────────────────────
  const patchScene = useCallback((idx: number, patch: Partial<CompositionScene>) => {
    setComp((c) => c && { ...c, scenes: c.scenes.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
    setDirty(true);
  }, []);

  // Regenerate-in-place: re-run a scene's AI generation (its `generation`
  // provenance) via the SAME provider registry + generation_jobs mechanism the
  // canvas uses (/api/generation/regenerate-scene → poll /api/generation/jobs/:id).
  // On completion it swaps the scene's background to the new asset and stamps the
  // scene's generation (generatedAt). The user clicks Save to persist (patchScene
  // marks dirty) — identical persistence path to every other scene edit.
  const regenerateScene = useCallback(async (idx: number, gen: SceneGeneration) => {
    if (regenIdx !== null) return; // one regen at a time
    setRegenIdx(idx);

    const apply = (url: string, kind: 'image' | 'video') => {
      patchScene(idx, {
        background: { type: kind, value: url },
        generation: { ...gen, generatedAt: Date.now() },
      });
      toast.success('Scene media regenerated — Save to persist.');
    };

    try {
      const res = await fetch('/api/generation/regenerate-scene', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ generation: { prompt: gen.prompt, model: gen.model, refs: gen.refs } }),
      });
      const j = (await res.json()) as { jobId?: number; status?: string; outputUrl?: string; kind?: 'image' | 'video'; error?: string };
      if (!res.ok) { toast.error(j.error || 'Regenerate failed'); setRegenIdx(null); return; }

      if (j.status === 'completed' && j.outputUrl) {
        apply(j.outputUrl, j.kind ?? 'image');
        setRegenIdx(null);
        return;
      }

      // async (Veo): poll the EXISTING jobs route — identical to canvas-board.runNode,
      // but BOUNDED so a job stuck 'processing' can't poll forever and lock the button.
      let attempts = 0;
      const MAX_ATTEMPTS = 90; // ~7.5 min at 5s — comfortably covers Veo video generation
      const poll = async () => {
        if (attempts++ >= MAX_ATTEMPTS) {
          toast.error('Regenerate timed out — try again.');
          setRegenIdx(null);
          return;
        }
        try {
          const r = await fetch(`/api/generation/jobs/${j.jobId}`);
          const s = (await r.json()) as { status?: string; outputUrl?: string; error?: string };
          if (s.status === 'completed' && s.outputUrl) { apply(s.outputUrl, j.kind ?? 'video'); setRegenIdx(null); return; }
          if (s.status === 'failed') { toast.error(s.error || 'Regenerate failed'); setRegenIdx(null); return; }
          setTimeout(poll, 5000);
        } catch { setTimeout(poll, 6000); }
      };
      setTimeout(poll, 4000);
    } catch (e) {
      toast.error((e as Error).message);
      setRegenIdx(null);
    }
  }, [regenIdx, patchScene]);
  const patchLayer = useCallback((sIdx: number, layerId: string, patch: Partial<TextLayer>) => {
    setComp((c) => c && {
      ...c,
      scenes: c.scenes.map((s, i) => i !== sIdx ? s : { ...s, layers: s.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) }),
    });
    setDirty(true);
  }, []);
  // Position-only patch (drag) — infographics are addressed by index because
  // agent-written ones may have no id.
  const patchIg = useCallback((sIdx: number, igIdx: number, patch: Partial<Pick<Infographic, 'xPct' | 'yPct'>>) => {
    setComp((c) => c && {
      ...c,
      scenes: c.scenes.map((s, i) => i !== sIdx ? s : { ...s, infographics: (s.infographics ?? []).map((g, k) => (k === igIdx ? { ...g, ...patch } as Infographic : g)) }),
    });
    setDirty(true);
  }, []);
  // Full replace — the props panel edits kind-specific data, so it hands back
  // the whole (discriminated-union) object rather than a partial.
  const replaceIg = useCallback((sIdx: number, igIdx: number, next: Infographic) => {
    setComp((c) => c && {
      ...c,
      scenes: c.scenes.map((s, i) => i !== sIdx ? s : { ...s, infographics: (s.infographics ?? []).map((g, k) => (k === igIdx ? next : g)) }),
    });
    setDirty(true);
  }, []);
  const setCaptionStyle = useCallback((cs: CaptionStyle) => {
    setComp((c) => c && { ...c, caption_style: cs });
    setDirty(true);
  }, []);

  // Timeline view: wholesale composition replacement from timeline ops (pure fns
  // already return new objects — just push through the same dirty flag).
  const handleTimelineChange = useCallback((next: Composition) => {
    setComp(next);
    setDirty(true);
  }, []);

  // Timeline view: map timeline selection identifiers back to the editor's own
  // selection state so the properties panel stays in sync.
  const handleTimelineSelect = useCallback((sel: TimelineSelection) => {
    if (sel.kind === 'scene') {
      setSceneIdx(sel.sceneIdx);
      setSelectedLayerId(null);
      setSelectedIg(null);
    } else if (sel.kind === 'layer') {
      setSceneIdx(sel.sceneIdx);
      setSelectedLayerId(sel.layerId);
      setSelectedIg(null);
    } else if (sel.kind === 'infographic') {
      setSceneIdx(sel.sceneIdx);
      setSelectedIg(sel.igIdx);
      setSelectedLayerId(null);
    } else if (sel.kind === 'overlay') {
      setSceneIdx(sel.sceneIdx);
      setSelectedLayerId(null);
      setSelectedIg(null);
    } else if (sel.kind === 'punch') {
      setSceneIdx(sel.sceneIdx);
      setSelectedLayerId(null);
      setSelectedIg(null);
    }
  }, []);

  // ── drag a text layer or infographic on the canvas ────────────────────────
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ sIdx: number; target: { kind: 'text'; layerId: string } | { kind: 'ig'; igIdx: number } } | null>(null);
  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current, el = canvasRef.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    if (d.target.kind === 'text') patchLayer(d.sIdx, d.target.layerId, { xPct: Math.round(x), yPct: Math.round(y) });
    else patchIg(d.sIdx, d.target.igIdx, { xPct: Math.round(x), yPct: Math.round(y) });
  }, [patchLayer, patchIg]);
  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }, [onMove]);
  const startDrag = useCallback((e: React.PointerEvent, layerId: string) => {
    e.stopPropagation();
    setSelectedLayerId(layerId);
    setSelectedIg(null);
    dragRef.current = { sIdx: sceneIdx, target: { kind: 'text', layerId } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [sceneIdx, onMove, onUp]);
  const startIgDrag = useCallback((e: React.PointerEvent, igIdx: number) => {
    e.stopPropagation();
    setSelectedIg(igIdx);
    setSelectedLayerId(null);
    dragRef.current = { sIdx: sceneIdx, target: { kind: 'ig', igIdx } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [sceneIdx, onMove, onUp]);
  useEffect(() => () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); }, [onMove, onUp]);

  // ── scene ops ─────────────────────────────────────────────────────────────
  const addScene = () => {
    setComp((c) => {
      if (!c) return c;
      const last = c.scenes[c.scenes.length - 1];
      const start = last ? last.endMs : 0;
      return { ...c, scenes: [...c.scenes, newScene(`s${Date.now() % 100000}`, start)] };
    });
    setDirty(true);
  };
  const deleteScene = (idx: number) => {
    setComp((c) => {
      if (!c || c.scenes.length <= 1) return c;
      const scenes = c.scenes.filter((_, i) => i !== idx);
      return { ...c, scenes };
    });
    setSceneIdx((i) => Math.max(0, Math.min(i, (comp?.scenes.length ?? 1) - 2)));
    setSelectedIg(null);
    setDirty(true);
  };
  const moveScene = (idx: number, dir: -1 | 1) => {
    setComp((c) => {
      if (!c) return c;
      const j = idx + dir;
      if (j < 0 || j >= c.scenes.length) return c;
      const scenes = [...c.scenes];
      [scenes[idx], scenes[j]] = [scenes[j], scenes[idx]];
      return { ...c, scenes };
    });
    setSceneIdx((i) => i + dir);
    setDirty(true);
  };
  const addText = () => {
    if (!scene) return;
    const lid = `${scene.id}-t${Date.now() % 100000}`;
    patchScene(sceneIdx, { layers: [...scene.layers, newTextLayer(lid)] });
    setSelectedLayerId(lid);
    setSelectedIg(null);
  };
  const deleteLayer = (layerId: string) => {
    if (!scene) return;
    patchScene(sceneIdx, { layers: scene.layers.filter((l) => l.id !== layerId) });
    setSelectedLayerId(null);
  };
  // New infographics start centered with starter data so they're visible (and
  // draggable) immediately; ids keep the renderer's '<sceneId>-igN' shape.
  const addIg = (kind: Infographic['kind']) => {
    if (!scene) return;
    const id = `${scene.id}-ig${Date.now() % 100000}`;
    const g: Infographic =
      kind === 'stat' ? { kind, id, start: 0, xPct: 50, yPct: 38, widthPct: 70, data: { value: '83%', label: 'Label' } }
      : kind === 'list' ? { kind, id, start: 0, xPct: 50, yPct: 45, widthPct: 80, data: { items: ['First point', 'Second point', 'Third point'] } }
      : { kind, id, start: 0, xPct: 50, yPct: 50, widthPct: 76, data: { label: 'Label', pct: 70 } };
    patchScene(sceneIdx, { infographics: [...(scene.infographics ?? []), g] });
    setSelectedIg((scene.infographics ?? []).length);
    setSelectedLayerId(null);
  };
  const deleteIg = (igIdx: number) => {
    if (!scene) return;
    const next = (scene.infographics ?? []).filter((_, k) => k !== igIdx);
    patchScene(sceneIdx, { infographics: next.length ? next : undefined });
    setSelectedIg(null);
  };

  const save = useCallback(async () => {
    if (!comp) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/hyperframes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ composition: comp }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      toast.success('Composition saved');
      setDirty(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }, [comp, id]);

  // Save the latest composition, then submit a HeyGen render.
  const renderNow = useCallback(async () => {
    if (rendering || isActiveRender(render)) return;
    setRendering(true);
    try {
      await save();
      const res = await fetch(`/api/hyperframes/${id}/render`, { method: 'POST' });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Render failed to start');
      setRender(j.render);
      toast.success('Rendering started — this takes a minute.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setRendering(false);
    }
  }, [rendering, render, save, id]);

  // Pre-fill publish title whenever the render completes or the draft loads.
  useEffect(() => {
    if (render?.status === 'completed' && !publishTitle) {
      setPublishTitle(draft?.title || '');
    }
  }, [render?.status, draft?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  const publishNow = useCallback(async () => {
    if (publishing) return;
    setPublishing(true);
    setPublishError(null);
    setPublishResult(null);
    try {
      const body: Record<string, unknown> = { platform: publishPlatform };
      if (publishPlatform === 'youtube_video') {
        body.title = publishTitle || draft?.title || `Reel ${id}`;
        body.description = publishDesc;
        body.privacy = publishPrivacy;
      } else {
        body.caption = publishCaption;
      }
      const res = await fetch(`/api/hyperframes/${id}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const j = await res.json();
      if (!res.ok || !j.ok) {
        setPublishError(j.error ?? 'Publish failed');
      } else {
        setPublishResult({ link: j.result?.link ?? null, message: j.message ?? 'Published!' });
        toast.success(j.message ?? 'Published!');
      }
    } catch (e) {
      setPublishError((e as Error).message);
    } finally {
      setPublishing(false);
    }
  }, [publishing, publishPlatform, publishTitle, publishDesc, publishCaption, publishPrivacy, draft, id]);

  // While a render is queued/rendering, poll HeyGen for status; stop when terminal.
  useEffect(() => {
    if (!isActiveRender(render)) return;
    let cancel = false;
    const tick = async () => {
      try {
        const j = await fetch(`/api/hyperframes/${id}/render`).then((r) => r.json());
        if (cancel || !j.render) return;
        setRender(j.render);
        if (j.render.status === 'completed' && j.render.video_url) { setShowPreview(true); toast.success('Render complete'); }
        if (j.render.status === 'failed') toast.error(j.render.error || 'Render failed');
      } catch { /* keep polling */ }
    };
    const iv = setInterval(tick, 5000);
    tick();
    return () => { cancel = true; clearInterval(iv); };
  }, [render?.status, render?.render_id, id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
  if (needsSeed && draft && !comp) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-6">
        <div className="panel max-w-md w-full text-center">
          <div className="panel-body py-10 space-y-4">
            <h2 className="text-h2">Build this reel</h2>
            <p className="text-small text-muted-foreground">
              Let the agent compose a rich reel from the storyboard — punch-ins, b-roll from your
              media library, infographics, styled captions — or start from a plain layout.
            </p>
            <button className="btn btn-primary" onClick={autobuild} disabled={autobuilding}>
              {autobuilding ? (<><Loader2 size={14} className="animate-spin" /> Composing…</>) : 'Auto-build rich reel'}
            </button>
            <div>
              <button className="btn btn-ghost btn-sm" onClick={plainSeed} disabled={autobuilding}>
                start from a plain seed
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (!comp || !draft) return <div className="p-6 text-sm text-muted-foreground flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading editor…</div>;

  return (
    <div className="animate-in flex flex-col h-[calc(100vh-var(--header-height)-1px)]">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/60 shrink-0">
        <Link href="/content/hyperframes" className="btn btn-ghost btn-sm"><ArrowLeft size={14} /> Hyperframes</Link>
        <div className="flex items-center gap-2 min-w-0">
          <Film size={15} className="text-[var(--primary)] shrink-0" />
          <span className="text-sm font-medium truncate">{draft.title || `Storyboard #${id}`}</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a className="btn btn-ghost btn-sm" href="https://hyperframes.heygen.com" target="_blank" rel="noreferrer">
            <ExternalLink size={13} /> HeyGen
          </a>
          {render?.status === 'completed' && render.video_url && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowPreview(true)}><Play size={13} /> Preview</button>
          )}
          {render?.status === 'completed' && (
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => { setShowPublish((v) => !v); setPublishError(null); setPublishResult(null); }}
            >
              <Send size={13} /> Publish
            </button>
          )}
          {/* Export to a real NLE — FCPXML (Premiere & DaVinci & Final Cut) or EDL.
              The links hit /api/hyperframes/:id/export, which serves the persisted
              composition with Content-Disposition: attachment (so it downloads). */}
          <div className="relative">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setExportOpen((v) => !v)}
              title="Export for Premiere Pro / DaVinci Resolve / Final Cut"
            >
              <Download size={13} /> Export to NLE
            </button>
            {exportOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportOpen(false)} />
                <div className="absolute right-0 top-full mt-1 z-30 rounded-md border border-border bg-card shadow-lg p-1 text-xs w-60">
                  <a
                    className="block px-2 py-1.5 rounded hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    href={`/api/hyperframes/${id}/export?format=fcpxml`}
                    onClick={() => setExportOpen(false)}
                  >
                    Final Cut XML (.fcpxml) <span className="text-muted-foreground">— Premiere &amp; DaVinci</span>
                  </a>
                  <a
                    className="block px-2 py-1.5 rounded hover:bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]"
                    href={`/api/hyperframes/${id}/export?format=edl`}
                    onClick={() => setExportOpen(false)}
                  >
                    EDL cut list (.edl)
                  </a>
                  <p className="px-2 py-1 text-[9px] text-muted-foreground border-t border-border/60 mt-1">
                    Tip: Save first to export your latest edits.
                  </p>
                </div>
              </>
            )}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={renderNow}
            disabled={rendering || isActiveRender(render)}
            title="Render this composition to video via HeyGen"
          >
            {rendering || isActiveRender(render)
              ? <><Loader2 size={13} className="animate-spin" /> {render?.status === 'rendering' ? 'Rendering…' : 'Queued…'}</>
              : <><Clapperboard size={13} /> Render</>}
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      {/* Publish panel — shown when the user toggles Publish in the top bar */}
      {showPublish && render?.status === 'completed' && (
        <div className="border-b border-border/60 bg-[color-mix(in_srgb,var(--surface-2)_50%,transparent)] px-4 py-3 shrink-0">
          <div className="max-w-2xl space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold">Publish to channel</span>
              <button className="btn btn-ghost btn-xs" onClick={() => setShowPublish(false)}><X size={12} /></button>
            </div>

            {publishResult ? (
              <div className="rounded-md border border-[color-mix(in_srgb,var(--primary)_35%,transparent)] bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] px-3 py-2.5 text-sm space-y-1">
                <p className="font-medium text-[var(--primary)]">{publishResult.message}</p>
                {publishResult.link && (
                  <a href={publishResult.link} target="_blank" rel="noreferrer" className="text-xs underline break-all text-[var(--primary)]">
                    {publishResult.link} <ExternalLink size={11} className="inline" />
                  </a>
                )}
                <button className="btn btn-ghost btn-xs mt-1" onClick={() => setPublishResult(null)}>Publish to another platform</button>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-3 items-start">
                  {/* Platform */}
                  <label className="block min-w-[160px]">
                    <span className="text-[10px] text-muted-foreground block mb-1">Platform</span>
                    <select
                      value={publishPlatform}
                      onChange={(e) => { setPublishPlatform(e.target.value as 'youtube_video' | 'instagram_reel'); setPublishError(null); setPublishResult(null); }}
                      className="text-xs px-2 w-full"
                    >
                      <option value="youtube_video">YouTube Video</option>
                      <option value="instagram_reel">Instagram Reel (reconnect if scopes updated)</option>
                    </select>
                  </label>

                  {/* YouTube-only: privacy */}
                  {publishPlatform === 'youtube_video' && (
                    <label className="block min-w-[120px]">
                      <span className="text-[10px] text-muted-foreground block mb-1">Visibility</span>
                      <select value={publishPrivacy} onChange={(e) => setPublishPrivacy(e.target.value as typeof publishPrivacy)} className="text-xs px-2 w-full">
                        <option value="public">Public</option>
                        <option value="unlisted">Unlisted</option>
                        <option value="private">Private</option>
                      </select>
                    </label>
                  )}
                </div>

                {/* YouTube: title + description */}
                {publishPlatform === 'youtube_video' && (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground block mb-1">Title</span>
                      <input
                        value={publishTitle}
                        onChange={(e) => setPublishTitle(e.target.value)}
                        placeholder={draft?.title || 'Video title'}
                        className="w-full text-xs px-2"
                      />
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-muted-foreground block mb-1">Description</span>
                      <textarea
                        value={publishDesc}
                        onChange={(e) => setPublishDesc(e.target.value)}
                        rows={2}
                        placeholder="Optional description…"
                        className="w-full text-xs resize-y"
                      />
                    </label>
                  </div>
                )}

                {/* Instagram: caption */}
                {publishPlatform === 'instagram_reel' && (
                  <label className="block">
                    <span className="text-[10px] text-muted-foreground block mb-1">Caption</span>
                    <textarea
                      value={publishCaption}
                      onChange={(e) => setPublishCaption(e.target.value)}
                      rows={2}
                      placeholder="Optional caption (hashtags welcome)…"
                      className="w-full text-xs resize-y"
                    />
                  </label>
                )}

                {publishError && (
                  <p className="text-xs text-destructive rounded-md border border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_7%,transparent)] px-2.5 py-1.5 font-mono break-all">
                    {publishError}
                  </p>
                )}

                <div className="flex items-center gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={publishNow}
                    disabled={publishing}
                  >
                    {publishing
                      ? <><Loader2 size={13} className="animate-spin" /> Publishing — IG can take a couple of minutes…</>
                      : <><Send size={13} /> Publish</>}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => setShowPublish(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div className="flex-1 min-h-0 flex flex-col">
        {/* View-mode toggle — lives above the content area */}
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-border/40 shrink-0 bg-[color-mix(in_srgb,var(--surface-2)_25%,transparent)]">
          <span className="text-[9px] uppercase tracking-wider text-muted-foreground/50 mr-1">View</span>
          {(['simple', 'timeline'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setViewMode(m)}
              className="btn btn-ghost btn-xs capitalize"
              style={{
                fontSize: 10, minHeight: 20, padding: '1px 10px',
                background: viewMode === m ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent',
                color: viewMode === m ? 'var(--primary)' : 'var(--muted-foreground)',
              }}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="flex-1 min-h-0 flex flex-col">
          {/* Main editor row: scene strip (simple only) + canvas + props */}
          <div
            className="flex-1 min-h-0 grid"
            style={{ gridTemplateColumns: viewMode === 'simple' ? '210px minmax(0,1fr) 300px' : 'minmax(0,1fr) 300px' }}
          >
          {/* Scene strip — simple mode only */}
          {viewMode === 'simple' && (
          <div className="border-r border-border/60 overflow-y-auto p-2 space-y-2">
          {comp.scenes.map((s, i) => (
            <SceneThumb
              key={s.id} scene={s} index={i} active={i === sceneIdx}
              onSelect={() => { setSceneIdx(i); setSelectedLayerId(null); setSelectedIg(null); }}
              onUp={() => moveScene(i, -1)} onDown={() => moveScene(i, 1)}
              onDelete={() => deleteScene(i)} canDelete={comp.scenes.length > 1}
            />
          ))}
          <button onClick={addScene} className="w-full btn btn-ghost btn-sm justify-center border border-dashed border-border/60">
            <Plus size={13} /> Add scene
          </button>
          </div>
          )}

        {/* Canvas */}
        <div className="overflow-auto flex items-center justify-center p-6 bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)]">
          {scene && (
            <div className="space-y-2">
              <div
                ref={canvasRef}
                onPointerDown={() => { setSelectedLayerId(null); setSelectedIg(null); }}
                className="relative rounded-lg overflow-hidden shadow-lg select-none"
                style={{ width: CANVAS_W, height: CANVAS_H, background: scene.background.type === 'color' ? scene.background.value : '#000' }}
              >
                {scene.background.type === 'image' && scene.background.value && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={scene.background.value} alt="" className="absolute inset-0 w-full h-full object-cover" />
                )}
                {scene.background.type === 'video' && scene.background.value && (
                  <video src={scene.background.value} className="absolute inset-0 w-full h-full object-cover" muted loop autoPlay playsInline />
                )}
                {/* Inset b-roll → a position-accurate placeholder (image overlays
                    preview for real; video overlays get a labeled block). Full-bleed
                    overlays would hide the whole layout on a static canvas, so they
                    surface only in the corner badge below. Rendered before text so
                    text/captions stay visually on top — same stacking as the render. */}
                {(scene.overlays ?? []).map((ov, k) => ov.frame === 'inset' && (
                  <div
                    key={`ov-${k}`} title={ov.src}
                    className="absolute overflow-hidden pointer-events-none"
                    style={{
                      left: '50%', top: ov.anchor === 'bottom' ? '52%' : '7%', transform: 'translateX(-50%)',
                      width: '62%', height: `${INSET_H_PCT}%`, borderRadius: 28 * FONT_SCALE,
                      boxShadow: '0 4px 14px rgba(0,0,0,0.45)', background: 'rgba(0,0,0,0.55)',
                    }}
                  >
                    {IMG_URL.test(ov.src) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={ov.src} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-0.5 border border-dashed border-white/35 text-white/85" style={{ borderRadius: 28 * FONT_SCALE }}>
                        <Video size={11} />
                        <span className="text-[8px] font-mono">b-roll {ov.start}–{Math.round((ov.start + ov.duration) * 10) / 10}s</span>
                      </div>
                    )}
                  </div>
                ))}
                {scene.layers.map((l) => (
                  <div
                    key={l.id}
                    onPointerDown={(e) => startDrag(e, l.id)}
                    className="absolute cursor-move"
                    style={{
                      left: `${l.xPct}%`, top: `${l.yPct}%`, width: `${l.widthPct}%`,
                      transform: 'translate(-50%, -50%)',
                      fontSize: l.fontSize * FONT_SCALE, color: l.color, textAlign: l.align,
                      fontWeight: l.weight, lineHeight: 1.1,
                      textShadow: '0 1px 6px rgba(0,0,0,0.45)',
                      outline: selectedLayerId === l.id ? '1.5px solid var(--primary)' : '1.5px solid transparent',
                      outlineOffset: 2, borderRadius: 2,
                    }}
                  >
                    {l.text || ' '}
                  </div>
                ))}
                {/* Infographics — real content, same drag mechanism as text layers. */}
                {(scene.infographics ?? []).map((g, k) => (
                  <div
                    key={g.id ?? `ig-${k}`}
                    onPointerDown={(e) => startIgDrag(e, k)}
                    className="absolute cursor-move"
                    style={{
                      left: `${g.xPct}%`, top: `${g.yPct}%`, width: `${g.widthPct}%`,
                      transform: 'translate(-50%, -50%)',
                      outline: selectedIg === k ? '1.5px solid var(--primary)' : '1.5px solid transparent',
                      outlineOffset: 2, borderRadius: 2,
                    }}
                  >
                    <InfographicPreview g={g} accent={accent} />
                  </div>
                ))}
                {/* Subtle badge whenever b-roll is spliced over this scene. */}
                {(scene.overlays?.length ?? 0) > 0 && (
                  <div
                    className="absolute top-1.5 left-1.5 z-10 pointer-events-none flex items-center gap-1 rounded-full bg-black/60 px-1.5 py-0.5 text-[8px] font-medium text-white/90"
                    title={scene.overlays!.map((o) => `${o.frame === 'full' ? 'Full-bleed' : 'Inset'} · ${o.start}s +${o.duration}s`).join('\n')}
                  >
                    <Film size={8} /> {scene.overlays!.length} b-roll
                  </div>
                )}
              </div>
              <div className="text-center text-[10px] text-muted-foreground font-mono">
                {scene.label ? `${scene.label} · ` : ''}{formatMs(scene.startMs)}–{formatMs(scene.endMs)} · 9:16
              </div>
            </div>
          )}
        </div>

        {/* Properties */}
        <div className="border-l border-border/60 overflow-y-auto p-3 space-y-4">
          {scene && (
            <>
              {selectedLayer ? (
                <LayerProps
                  layer={selectedLayer}
                  onChange={(patch) => patchLayer(sceneIdx, selectedLayer.id, patch)}
                  onDelete={() => deleteLayer(selectedLayer.id)}
                />
              ) : selectedInfographic && selectedIg !== null ? (
                <InfographicProps
                  g={selectedInfographic}
                  onChange={(next) => replaceIg(sceneIdx, selectedIg, next)}
                  onDelete={() => deleteIg(selectedIg)}
                />
              ) : (
                <SceneProps
                  scene={scene}
                  captionStyle={comp.caption_style}
                  onChange={(patch) => patchScene(sceneIdx, patch)}
                  onCaptionStyle={setCaptionStyle}
                  onAddText={addText}
                  onSelectLayer={(id) => { setSelectedLayerId(id); setSelectedIg(null); }}
                  onAddIg={addIg}
                  onSelectIg={(k) => { setSelectedIg(k); setSelectedLayerId(null); }}
                  regenerating={regenIdx === sceneIdx}
                  onRegenerate={(gen) => regenerateScene(sceneIdx, gen)}
                />
              )}
            </>
          )}
        </div>
        </div>{/* end grid */}

        {/* Timeline view — shown when viewMode === 'timeline' */}
        {viewMode === 'timeline' && (
          <div className="shrink-0" style={{ height: 180, borderTop: '1px solid var(--border)' }}>
            <Timeline
              comp={comp}
              sceneIdx={sceneIdx}
              selectedLayerId={selectedLayerId}
              selectedIg={selectedIg}
              onChange={handleTimelineChange}
              onSelect={handleTimelineSelect}
            />
          </div>
        )}
        </div>{/* end inner flex-col */}
      </div>{/* end outer flex-col */}

      {showPreview && render?.video_url && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-6" onClick={() => setShowPreview(false)}>
          <div onClick={(e) => e.stopPropagation()} className="flex flex-col items-center gap-3">
            <video src={render.video_url} controls autoPlay loop className="max-h-[82vh] rounded-xl shadow-2xl" style={{ aspectRatio: '9 / 16' }} />
            <div className="flex gap-2">
              <a className="btn btn-secondary btn-sm" href={render.video_url} target="_blank" rel="noreferrer"><Download size={13} /> Download</a>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowPreview(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SceneThumb({ scene, index, active, onSelect, onUp, onDown, onDelete, canDelete }: {
  scene: CompositionScene; index: number; active: boolean; onSelect: () => void;
  onUp: () => void; onDown: () => void; onDelete: () => void; canDelete: boolean;
}) {
  const firstText = scene.layers.find((l) => l.type === 'text')?.text;
  return (
    <div
      onClick={onSelect}
      className="rounded-lg border p-1.5 cursor-pointer"
      style={{ borderColor: active ? 'var(--primary)' : 'var(--border)', background: active ? 'color-mix(in srgb, var(--primary) 8%, transparent)' : 'transparent' }}
    >
      <div className="flex items-center gap-1 mb-1">
        <span className="text-[10px] font-semibold text-[var(--primary)]">{scene.label || `#${index + 1}`}</span>
        <span className="text-[9px] text-muted-foreground font-mono ml-auto">{formatMs(scene.startMs)}</span>
      </div>
      <div
        className="relative w-full rounded overflow-hidden flex items-center justify-center text-center"
        style={{ aspectRatio: '9 / 16', background: scene.background.type === 'color' ? scene.background.value : '#111' }}
      >
        {firstText && <span className="text-[7px] text-white/90 px-1 line-clamp-3" style={{ textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}>{firstText}</span>}
      </div>
      <div className="flex items-center gap-0.5 mt-1">
        <button onClick={(e) => { e.stopPropagation(); onUp(); }} className="btn btn-ghost btn-xs p-1"><ChevronUp size={11} /></button>
        <button onClick={(e) => { e.stopPropagation(); onDown(); }} className="btn btn-ghost btn-xs p-1"><ChevronDown size={11} /></button>
        {canDelete && <button onClick={(e) => { e.stopPropagation(); onDelete(); }} className="btn btn-ghost btn-xs p-1 ml-auto text-destructive"><Trash2 size={11} /></button>}
      </div>
    </div>
  );
}

function SceneProps({ scene, captionStyle, onChange, onCaptionStyle, onAddText, onSelectLayer, onAddIg, onSelectIg, regenerating, onRegenerate }: {
  scene: CompositionScene;
  captionStyle?: CaptionStyle;
  onChange: (p: Partial<CompositionScene>) => void;
  onCaptionStyle: (cs: CaptionStyle) => void;
  onAddText: () => void;
  onSelectLayer: (id: string) => void;
  onAddIg: (kind: Infographic['kind']) => void;
  onSelectIg: (igIdx: number) => void;
  regenerating: boolean;
  onRegenerate: (gen: SceneGeneration) => void;
}) {
  const bg = scene.background;
  const overlays = scene.overlays ?? [];
  // Empty arrays serialize as undefined so an untouched scene stays legacy-identical.
  const setOverlays = (next: BrollOverlay[]) => onChange({ overlays: next.length ? next : undefined });
  return (
    <div className="space-y-3">
      <SectionLabel>Scene</SectionLabel>

      <Field label="Background">
        <select
          value={bg.type}
          onChange={(e) => onChange({ background: { type: e.target.value as 'color' | 'image' | 'video', value: e.target.value === 'color' ? (bg.type === 'color' ? bg.value : '#0B0B0F') : bg.type === 'color' ? '' : bg.value } })}
          className="w-full text-xs px-2"
        >
          <option value="color">Color</option>
          <option value="image">Image</option>
          <option value="video">Video / b-roll</option>
        </select>
        {bg.type === 'color' ? (
          <div className="flex items-center gap-1.5 mt-1.5">
            <input type="color" value={bg.value || '#0B0B0F'} onChange={(e) => onChange({ background: { type: 'color', value: e.target.value } })} className="w-8 h-7 rounded border border-border p-0.5 bg-transparent" />
            <input value={bg.value} onChange={(e) => onChange({ background: { type: 'color', value: e.target.value } })} className="flex-1 text-xs px-2 font-mono" />
          </div>
        ) : (
          <input
            value={bg.value} placeholder="https://… (image or video URL)"
            onChange={(e) => onChange({ background: { ...bg, value: e.target.value } })}
            className="w-full text-xs px-2 mt-1.5"
          />
        )}
        <AssetPicker onPick={(url, kind) => onChange({ background: { type: kind, value: url } })} />
      </Field>

      {/* AI generation — re-roll the scene's AI-generated background IN PLACE.
          When the scene carries `generation` provenance, the prompt/model are
          editable and "Regenerate" re-runs it via the provider registry, swapping
          the background to the new asset. Default-absent: an "Add" affordance lets
          the user mark a background AI-generated (seeded from the scene's note/VO). */}
      <div>
        <SectionLabel>AI generation</SectionLabel>
        {scene.generation ? (
          <div className="space-y-1.5 mt-1">
            <Field label="Prompt">
              <textarea
                value={scene.generation.prompt}
                rows={2}
                className="w-full text-xs resize-y"
                onChange={(e) => onChange({ generation: { ...scene.generation!, prompt: e.target.value } })}
              />
            </Field>
            <Field label="Model">
              <select
                value={scene.generation.model}
                className="w-full text-xs px-2"
                onChange={(e) => onChange({ generation: { ...scene.generation!, model: e.target.value } })}
              >
                <option value="nanobanana">Nano Banana (image)</option>
                <option value="veo">Veo (video)</option>
              </select>
            </Field>
            <button
              className="btn btn-secondary btn-sm w-full justify-center"
              disabled={regenerating}
              onClick={() => onRegenerate(scene.generation!)}
            >
              {regenerating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Regenerate in place
            </button>
            {scene.generation.generatedAt && (
              <p className="text-[9px] text-muted-foreground">Last generated {new Date(scene.generation.generatedAt).toLocaleString()}</p>
            )}
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm w-full justify-center border border-dashed border-border/60 mt-1"
            onClick={() => onChange({ generation: { prompt: scene.note || scene.voiceover || '', model: 'nanobanana' } })}
          >
            <Sparkles size={11} /> Make this background AI-generated
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)">
          <input type="number" step={0.5} min={0} value={scene.startMs / 1000}
            onChange={(e) => onChange({ startMs: Math.max(0, Number(e.target.value) * 1000) })} className="w-full text-xs px-2" />
        </Field>
        <Field label="End (s)">
          <input type="number" step={0.5} min={0} value={scene.endMs / 1000}
            onChange={(e) => onChange({ endMs: Math.max(0, Number(e.target.value) * 1000) })} className="w-full text-xs px-2" />
        </Field>
      </div>

      <Field label="Voiceover">
        <textarea value={scene.voiceover ?? ''} onChange={(e) => onChange({ voiceover: e.target.value })} rows={2} className="w-full text-xs resize-y" placeholder="VO line for this scene…" />
      </Field>

      <Field label="Captions (on-screen words)">
        <textarea value={scene.caption ?? ''} onChange={(e) => onChange({ caption: e.target.value })} rows={2} className="w-full text-xs resize-y" placeholder="Spoken words — popped in word-by-word at the bottom" />
      </Field>

      <CaptionStyleControls value={captionStyle} onChange={onCaptionStyle} />

      {scene.note && (
        <div className="text-[10px] text-muted-foreground rounded-md bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] p-2">
          <span className="uppercase tracking-wide text-[8px] mr-1">Direction</span>{scene.note}
        </div>
      )}

      <div>
        <SectionLabel>Motion</SectionLabel>
        <div className="space-y-2 mt-1">
          <Field label="Transition in">
            <select
              value={scene.transition_in ?? 'cut'}
              onChange={(e) => { const v = e.target.value as SceneTransition; onChange({ transition_in: v === 'cut' ? undefined : v }); }}
              className="w-full text-xs px-2"
            >
              {SCENE_TRANSITIONS.map((t) => <option key={t} value={t}>{TRANSITION_LABELS[t]}</option>)}
            </select>
          </Field>
          <PunchBeats
            punches={scene.punches}
            durationS={(scene.endMs - scene.startMs) / 1000}
            onChange={(p) => onChange({ punches: p.length ? p : undefined })}
          />
        </div>
      </div>

      <div>
        <SectionLabel>B-roll overlays</SectionLabel>
        <div className="space-y-1.5 mt-1">
          {overlays.map((ov, k) => (
            <OverlayItem
              key={k} ov={ov}
              onChange={(next) => setOverlays(overlays.map((o, i) => (i === k ? next : o)))}
              onDelete={() => setOverlays(overlays.filter((_, i) => i !== k))}
            />
          ))}
          {overlays.length === 0 && (
            <p className="text-[10px] text-muted-foreground">Splice a clip over this scene — pick one below.</p>
          )}
          <AssetPicker onPick={(url) => setOverlays([...overlays, { kind: 'broll', src: url, start: 0, duration: 2, fit: 'cover', frame: 'full' }])} />
        </div>
      </div>

      <div>
        <SectionLabel>Infographics</SectionLabel>
        <div className="space-y-1 mt-1">
          {(scene.infographics ?? []).map((g, k) => (
            <button key={g.id ?? k} onClick={() => onSelectIg(k)} className="w-full text-left text-xs px-2 py-1.5 rounded-md border border-border/50 truncate flex items-center gap-1.5">
              {g.kind === 'stat' ? <Hash size={11} className="text-muted-foreground shrink-0" />
                : g.kind === 'list' ? <ListChecks size={11} className="text-muted-foreground shrink-0" />
                : <BarChart3 size={11} className="text-muted-foreground shrink-0" />}
              {g.kind === 'stat' ? `${g.data.value}${g.data.label ? ` · ${g.data.label}` : ''}`
                : g.kind === 'list' ? `${g.data.items.filter((i) => i.trim()).length} items`
                : `${g.data.label} · ${g.data.pct}%`}
            </button>
          ))}
          <div className="grid grid-cols-3 gap-1">
            <button onClick={() => onAddIg('stat')} className="btn btn-ghost btn-sm justify-center border border-dashed border-border/60"><Plus size={11} /> Stat</button>
            <button onClick={() => onAddIg('list')} className="btn btn-ghost btn-sm justify-center border border-dashed border-border/60"><Plus size={11} /> List</button>
            <button onClick={() => onAddIg('bar')} className="btn btn-ghost btn-sm justify-center border border-dashed border-border/60"><Plus size={11} /> Bar</button>
          </div>
        </div>
      </div>

      <div>
        <SectionLabel>Text layers</SectionLabel>
        <div className="space-y-1 mt-1">
          {scene.layers.map((l) => (
            <button key={l.id} onClick={() => onSelectLayer(l.id)} className="w-full text-left text-xs px-2 py-1.5 rounded-md border border-border/50 truncate flex items-center gap-1.5">
              <Type size={11} className="text-muted-foreground shrink-0" /> {l.text || '(empty)'}
            </button>
          ))}
          <button onClick={onAddText} className="w-full btn btn-ghost btn-sm justify-center border border-dashed border-border/60"><Plus size={12} /> Add text</button>
        </div>
      </div>
    </div>
  );
}

// Composition-level caption styling — lives next to the per-scene caption text
// since that's where the user is thinking about captions. Writes through to
// comp.caption_style (defaults = today's classic band, render-identical).
function CaptionStyleControls({ value, onChange }: { value?: CaptionStyle; onChange: (cs: CaptionStyle) => void }) {
  const preset = value?.preset ?? 'classic';
  const accent = value?.accent_color || DEFAULT_ACCENT;
  const size = value?.size ?? 'md';
  const set = (patch: Partial<CaptionStyle>) => onChange({ preset, accent_color: accent, size, ...patch });
  const capPx = (size === 'lg' ? 76 : 62) * FONT_SCALE;
  return (
    <div className="space-y-2">
      <Field label="Caption style (all scenes)">
        <div className="flex gap-1">
          {(['classic', 'boxed', 'highlight'] as const).map((p) => (
            <button key={p} onClick={() => set({ preset: p })}
              className="flex-1 btn btn-sm justify-center text-xs capitalize"
              style={{ background: preset === p ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: preset === p ? 'var(--primary)' : 'var(--muted-foreground)' }}>
              {p}
            </button>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Accent">
          <div className="flex items-center gap-1.5">
            <input type="color" value={/^#[0-9a-fA-F]{6}$/.test(accent) ? accent : DEFAULT_ACCENT}
              onChange={(e) => set({ accent_color: e.target.value })} className="w-8 h-7 rounded border border-border p-0.5 bg-transparent shrink-0" />
            <input value={accent} onChange={(e) => set({ accent_color: e.target.value })} className="flex-1 min-w-0 text-xs px-2 font-mono" />
          </div>
        </Field>
        <Field label="Size">
          <div className="flex gap-1">
            {([['md', '62px'], ['lg', '76px']] as const).map(([s, label]) => (
              <button key={s} onClick={() => set({ size: s })}
                className="flex-1 btn btn-sm justify-center text-xs"
                style={{ background: size === s ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: size === s ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                {label}
              </button>
            ))}
          </div>
        </Field>
      </div>
      {/* Truthful mini-preview of the band (middle word = the one "popping"). */}
      <div className="rounded-md px-2 py-2 text-center select-none" style={{ background: 'linear-gradient(135deg, #2E2E36, #17171C)' }}>
        {['SO', 'HERE’S', 'THE'].map((w, i) => (
          <span key={w} style={{
            display: 'inline-block', margin: '0 0.12em', fontWeight: 800, lineHeight: 1.18, fontSize: capPx,
            color: preset === 'highlight' && i === 1 ? '#111111' : '#FFFFFF',
            background: preset === 'boxed' ? 'rgba(0,0,0,.68)' : preset === 'highlight' && i === 1 ? accent : 'transparent',
            padding: preset === 'boxed' ? '0.05em 0.22em' : preset === 'highlight' ? '0.04em 0.18em' : undefined,
            borderRadius: preset === 'classic' ? undefined : 14 * FONT_SCALE,
            textShadow: preset === 'highlight' && i === 1 ? undefined : '0 1px 4px rgba(0,0,0,.65)',
          }}>{w}</span>
        ))}
      </div>
    </div>
  );
}

// Punch-in beat chips — click a chip to remove it; beats past the scene end are
// flagged (the renderer skips them).
function PunchBeats({ punches, durationS, onChange }: { punches?: number[]; durationS: number; onChange: (p: number[]) => void }) {
  const [draft, setDraft] = useState('');
  const beats = punches ?? [];
  const add = () => {
    const v = Number(draft);
    if (!Number.isFinite(v) || v <= 0) return;
    onChange([...beats.filter((b) => b !== v), v].sort((a, b) => a - b));
    setDraft('');
  };
  return (
    <Field label="Punch beats (s after scene start)">
      {beats.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1.5">
          {beats.map((b, i) => (
            <button key={`${b}-${i}`} onClick={() => onChange(beats.filter((_, k) => k !== i))}
              className="btn btn-ghost inline-flex items-center gap-1 font-mono"
              style={{
                minHeight: 20, padding: '1px 7px', fontSize: 10, borderRadius: 999,
                ...(b >= durationS ? { color: 'var(--destructive)', borderColor: 'color-mix(in srgb, var(--destructive) 40%, transparent)' } : {}),
              }}
              title={b >= durationS ? 'Past the scene end — skipped at render. Click to remove.' : 'Click to remove'}>
              {b}s <X size={9} />
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-1.5">
        <input type="number" step={0.1} min={0} value={draft} placeholder="e.g. 1.2"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }}
          className="flex-1 min-w-0 text-xs px-2" />
        <button onClick={add} disabled={!draft} className="btn btn-ghost btn-sm shrink-0"><Plus size={12} /> Beat</button>
      </div>
    </Field>
  );
}

// One b-roll splice — timing + full-bleed vs inset PiP (+ anchor when inset).
function OverlayItem({ ov, onChange, onDelete }: { ov: BrollOverlay; onChange: (next: BrollOverlay) => void; onDelete: () => void }) {
  const name = ov.src.split('/').pop()?.split('?')[0] || ov.src;
  return (
    <div className="rounded-md border border-border/50 p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {IMG_URL.test(ov.src)
          ? <ImageIcon size={11} className="text-muted-foreground shrink-0" />
          : <Video size={11} className="text-muted-foreground shrink-0" />}
        <span className="text-[10px] truncate flex-1" title={ov.src}>{name}</span>
        <button onClick={onDelete} className="btn btn-ghost btn-xs p-1 text-destructive shrink-0"><Trash2 size={11} /></button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)">
          <input type="number" step={0.1} min={0} value={ov.start}
            onChange={(e) => onChange({ ...ov, start: Math.max(0, Number(e.target.value)) })} className="w-full text-xs px-2" />
        </Field>
        <Field label="Duration (s)">
          <input type="number" step={0.1} min={0.1} value={ov.duration}
            onChange={(e) => onChange({ ...ov, duration: Math.max(0.1, Number(e.target.value)) })} className="w-full text-xs px-2" />
        </Field>
      </div>
      <div className="flex gap-1">
        {([['full', 'Full-bleed'], ['inset', 'Inset PiP']] as const).map(([f, label]) => (
          <button key={f} onClick={() => onChange({ ...ov, frame: f })}
            className="flex-1 btn btn-sm justify-center text-xs"
            style={{ background: ov.frame === f ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: ov.frame === f ? 'var(--primary)' : 'var(--muted-foreground)' }}>
            {label}
          </button>
        ))}
      </div>
      {ov.frame === 'inset' && (
        <div className="flex gap-1">
          {(['top', 'bottom'] as const).map((a) => (
            <button key={a} onClick={() => onChange({ ...ov, anchor: a })}
              className="flex-1 btn btn-sm justify-center text-xs capitalize"
              style={{ background: (ov.anchor ?? 'top') === a ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: (ov.anchor ?? 'top') === a ? 'var(--primary)' : 'var(--muted-foreground)' }}>
              {a}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LayerProps({ layer, onChange, onDelete }: {
  layer: TextLayer; onChange: (p: Partial<TextLayer>) => void; onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>Text</SectionLabel>
        <button onClick={onDelete} className="btn btn-ghost btn-xs text-destructive"><Trash2 size={12} /></button>
      </div>

      <Field label="Content">
        <textarea value={layer.text} onChange={(e) => onChange({ text: e.target.value })} rows={3} className="w-full text-xs resize-y" autoFocus />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Size">
          <input type="number" min={8} max={200} value={layer.fontSize} onChange={(e) => onChange({ fontSize: Math.max(8, Number(e.target.value)) })} className="w-full text-xs px-2" />
        </Field>
        <Field label="Color">
          <input type="color" value={layer.color} onChange={(e) => onChange({ color: e.target.value })} className="w-full h-7 rounded border border-border p-0.5 bg-transparent" />
        </Field>
      </div>

      <Field label="Align">
        <div className="flex gap-1">
          {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => (
            <button key={a} onClick={() => onChange({ align: a })}
              className="flex-1 btn btn-sm justify-center"
              style={{ background: layer.align === a ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: layer.align === a ? 'var(--primary)' : 'var(--muted-foreground)' }}>
              <Icon size={13} />
            </button>
          ))}
        </div>
      </Field>

      <Field label="Weight">
        <div className="flex gap-1">
          {([400, 600, 800] as const).map((w) => (
            <button key={w} onClick={() => onChange({ weight: w })}
              className="flex-1 btn btn-sm justify-center text-xs"
              style={{ fontWeight: w, background: layer.weight === w ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent', color: layer.weight === w ? 'var(--primary)' : 'var(--muted-foreground)' }}>
              {w === 400 ? 'Reg' : w === 600 ? 'Med' : 'Bold'}
            </button>
          ))}
        </div>
      </Field>

      <Field label="Width">
        <input type="range" min={20} max={100} value={layer.widthPct} onChange={(e) => onChange({ widthPct: Number(e.target.value) })} className="w-full" />
      </Field>

      <p className="text-[10px] text-muted-foreground">Tip: drag the text on the frame to reposition. ({layer.xPct}, {layer.yPct})</p>
    </div>
  );
}

// Selected-infographic panel — kind-specific data inline + shared timing/width.
// Hands back the whole object (discriminated union) rather than a partial.
function InfographicProps({ g, onChange, onDelete }: {
  g: Infographic; onChange: (next: Infographic) => void; onDelete: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SectionLabel>{g.kind === 'stat' ? 'Stat infographic' : g.kind === 'list' ? 'List infographic' : 'Bar infographic'}</SectionLabel>
        <button onClick={onDelete} className="btn btn-ghost btn-xs text-destructive"><Trash2 size={12} /></button>
      </div>

      {g.kind === 'stat' && (
        <>
          <Field label="Value">
            <input value={g.data.value} onChange={(e) => onChange({ ...g, data: { ...g.data, value: e.target.value } })} className="w-full text-xs px-2" autoFocus />
          </Field>
          <Field label="Label">
            <input value={g.data.label} onChange={(e) => onChange({ ...g, data: { ...g.data, label: e.target.value } })} className="w-full text-xs px-2" />
          </Field>
        </>
      )}
      {g.kind === 'list' && (
        <Field label="Items (one per line)">
          <textarea rows={4} value={g.data.items.join('\n')}
            onChange={(e) => onChange({ ...g, data: { items: e.target.value.split('\n') } })}
            className="w-full text-xs resize-y" autoFocus />
        </Field>
      )}
      {g.kind === 'bar' && (
        <>
          <Field label="Label">
            <input value={g.data.label} onChange={(e) => onChange({ ...g, data: { ...g.data, label: e.target.value } })} className="w-full text-xs px-2" autoFocus />
          </Field>
          <Field label={`Fill — ${g.data.pct}%`}>
            <input type="range" min={0} max={100} value={g.data.pct}
              onChange={(e) => onChange({ ...g, data: { ...g.data, pct: Number(e.target.value) } })} className="w-full" />
          </Field>
          <Field label="Caption (optional)">
            <input value={g.data.caption ?? ''}
              onChange={(e) => onChange({ ...g, data: { ...g.data, caption: e.target.value || undefined } })} className="w-full text-xs px-2" />
          </Field>
        </>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Start (s)">
          <input type="number" step={0.1} min={0} value={g.start}
            onChange={(e) => onChange({ ...g, start: Math.max(0, Number(e.target.value)) })} className="w-full text-xs px-2" />
        </Field>
        <Field label="Duration (s)">
          <input type="number" step={0.1} min={0.1} value={g.duration ?? ''} placeholder="rest of scene"
            onChange={(e) => onChange({ ...g, duration: e.target.value === '' ? undefined : Math.max(0.1, Number(e.target.value)) })} className="w-full text-xs px-2" />
        </Field>
      </div>

      <Field label="Width">
        <input type="range" min={20} max={100} value={g.widthPct} onChange={(e) => onChange({ ...g, widthPct: Number(e.target.value) })} className="w-full" />
      </Field>

      <p className="text-[10px] text-muted-foreground">Tip: drag the block on the frame to reposition. ({g.xPct}, {g.yPct})</p>
    </div>
  );
}

// Static, truthful canvas preview of an infographic — same markup proportions
// as infographicClip() in hyperframes-html, scaled by FONT_SCALE.
function InfographicPreview({ g, accent }: { g: Infographic; accent: string }) {
  const fs = FONT_SCALE;
  const shadow = '0 1px 6px rgba(0,0,0,0.5)';
  if (g.kind === 'stat') {
    return (
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 150 * fs, fontWeight: 800, lineHeight: 1, color: accent, textShadow: shadow }}>{g.data.value}</div>
        {g.data.label && <div style={{ fontSize: 44 * fs, fontWeight: 600, marginTop: 10 * fs, color: '#FFFFFF', textShadow: shadow }}>{g.data.label}</div>}
      </div>
    );
  }
  if (g.kind === 'list') {
    return (
      <div style={{ textAlign: 'left' }}>
        {g.data.items.filter((i) => i.trim()).map((item, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 18 * fs, margin: `${14 * fs}px 0`, fontSize: 50 * fs, fontWeight: 700, color: '#FFFFFF', textShadow: shadow }}>
            <span style={{ color: accent, fontWeight: 800 }}>&#10003;</span><span>{item}</span>
          </div>
        ))}
      </div>
    );
  }
  return (
    <div style={{ textAlign: 'left' }}>
      <div style={{ fontSize: 42 * fs, fontWeight: 700, marginBottom: 12 * fs, color: '#FFFFFF', textShadow: shadow }}>{g.data.label}</div>
      <div style={{ width: '100%', height: 52 * fs, borderRadius: 26 * fs, background: 'rgba(255,255,255,.16)', overflow: 'hidden' }}>
        <div style={{ width: `${g.data.pct}%`, height: '100%', borderRadius: 26 * fs, background: accent }} />
      </div>
      {g.data.caption && <div style={{ fontSize: 32 * fs, fontWeight: 600, marginTop: 10 * fs, color: 'rgba(255,255,255,.78)', textShadow: shadow }}>{g.data.caption}</div>}
    </div>
  );
}

interface Asset { id: number; kind: 'video' | 'image'; name: string | null; url: string }

// The tenant's clip library — upload a-roll/b-roll + click to drop a clip onto
// the current scene's background. ("Switch and mash clips.")
function AssetPicker({ onPick }: { onPick: (url: string, kind: 'video' | 'image') => void }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [uploading, setUploading] = useState(false);
  const load = useCallback(() => {
    fetch('/api/assets').then((r) => r.json()).then((j) => setAssets(j.assets || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const upload = useCallback(async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/assets', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Upload failed');
      await load();
      onPick(j.asset.url, j.asset.kind);
      toast.success('Clip added');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  }, [load, onPick]);

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Your clips</span>
        <label className="btn btn-ghost btn-xs cursor-pointer">
          {uploading ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />} Upload
          <input type="file" accept="video/*,image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </label>
      </div>
      {assets.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5 max-h-32 overflow-y-auto">
          {assets.map((a) => (
            <button key={a.id} onClick={() => onPick(a.url, a.kind)} title={a.name || ''}
              className="relative rounded overflow-hidden border border-border/50 hover:border-[var(--primary)]"
              style={{ aspectRatio: '9 / 16' }}>
              {a.kind === 'image' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt="" className="w-full h-full object-cover" />
              ) : (
                <video src={a.url} muted preload="metadata" className="w-full h-full object-cover" />
              )}
              <span className="absolute bottom-0.5 right-0.5 text-white/90">
                {a.kind === 'image' ? <ImageIcon size={9} /> : <Video size={9} />}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">{children}</div>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] text-muted-foreground block mb-1">{label}</span>
      {children}
    </label>
  );
}
