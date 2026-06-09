'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  ArrowLeft, Save, Loader2, Plus, Trash2, Type, ChevronUp, ChevronDown,
  AlignLeft, AlignCenter, AlignRight, ExternalLink, Film, Clapperboard,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { parseStoryboard } from '@/lib/hyperframes-storyboard';
import {
  compositionFromStoryboard, isComposition, newScene, newTextLayer, formatMs,
  type Composition, type CompositionScene, type TextLayer,
} from '@/lib/hyperframes-composition';
import type { DraftRow } from '@/lib/drafts';

// Visual scene editor (Phase 2a) — edit the video layer of a storyboard before
// rendering: position on-screen text on a live 9:16 frame, set the background /
// b-roll, tweak timing + VO. Saves the structured composition to the draft
// (metadata.composition). HeyGen rendering hooks onto this in Phase 2b.

const CANVAS_W = 300;                 // px; 9:16 → height below
const CANVAS_H = Math.round((CANVAS_W * 16) / 9);
const FONT_SCALE = CANVAS_W / 1080;   // composition fontSize is at a 1080px reference

export default function HyperframesEditorPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);

  const [draft, setDraft] = useState<DraftRow | null>(null);
  const [comp, setComp] = useState<Composition | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the draft, then use its saved composition or seed one from the storyboard.
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
        setComp(isComposition(saved) ? saved : compositionFromStoryboard(parseStoryboard(d.payload)));
      })
      .catch((e) => !cancel && setError((e as Error).message));
    return () => { cancel = true; };
  }, [id]);

  const scene: CompositionScene | undefined = comp?.scenes[sceneIdx];
  const selectedLayer = scene?.layers.find((l) => l.id === selectedLayerId) ?? null;

  // ── immutable updates ─────────────────────────────────────────────────────
  const patchScene = useCallback((idx: number, patch: Partial<CompositionScene>) => {
    setComp((c) => c && { ...c, scenes: c.scenes.map((s, i) => (i === idx ? { ...s, ...patch } : s)) });
    setDirty(true);
  }, []);
  const patchLayer = useCallback((sIdx: number, layerId: string, patch: Partial<TextLayer>) => {
    setComp((c) => c && {
      ...c,
      scenes: c.scenes.map((s, i) => i !== sIdx ? s : { ...s, layers: s.layers.map((l) => (l.id === layerId ? { ...l, ...patch } : l)) }),
    });
    setDirty(true);
  }, []);

  // ── drag a text layer on the canvas ───────────────────────────────────────
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ layerId: string; sIdx: number } | null>(null);
  const onMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current, el = canvasRef.current;
    if (!d || !el) return;
    const r = el.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    patchLayer(d.sIdx, d.layerId, { xPct: Math.round(x), yPct: Math.round(y) });
  }, [patchLayer]);
  const onUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
  }, [onMove]);
  const startDrag = useCallback((e: React.PointerEvent, layerId: string) => {
    e.stopPropagation();
    setSelectedLayerId(layerId);
    dragRef.current = { layerId, sIdx: sceneIdx };
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
  };
  const deleteLayer = (layerId: string) => {
    if (!scene) return;
    patchScene(sceneIdx, { layers: scene.layers.filter((l) => l.id !== layerId) });
    setSelectedLayerId(null);
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

  if (error) return <div className="p-6 text-sm text-destructive">Failed to load: {error}</div>;
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
          <button className="btn btn-secondary btn-sm" disabled title="In-app rendering arrives in Phase 2b">
            <Clapperboard size={13} /> Render (soon)
          </button>
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} {dirty ? 'Save' : 'Saved'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[210px_minmax(0,1fr)_300px]">
        {/* Scene strip */}
        <div className="border-r border-border/60 overflow-y-auto p-2 space-y-2">
          {comp.scenes.map((s, i) => (
            <SceneThumb
              key={s.id} scene={s} index={i} active={i === sceneIdx}
              onSelect={() => { setSceneIdx(i); setSelectedLayerId(null); }}
              onUp={() => moveScene(i, -1)} onDown={() => moveScene(i, 1)}
              onDelete={() => deleteScene(i)} canDelete={comp.scenes.length > 1}
            />
          ))}
          <button onClick={addScene} className="w-full btn btn-ghost btn-sm justify-center border border-dashed border-border/60">
            <Plus size={13} /> Add scene
          </button>
        </div>

        {/* Canvas */}
        <div className="overflow-auto flex items-center justify-center p-6 bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)]">
          {scene && (
            <div className="space-y-2">
              <div
                ref={canvasRef}
                onPointerDown={() => setSelectedLayerId(null)}
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
              ) : (
                <SceneProps
                  scene={scene}
                  onChange={(patch) => patchScene(sceneIdx, patch)}
                  onAddText={addText}
                  onSelectLayer={setSelectedLayerId}
                />
              )}
            </>
          )}
        </div>
      </div>
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

function SceneProps({ scene, onChange, onAddText, onSelectLayer }: {
  scene: CompositionScene; onChange: (p: Partial<CompositionScene>) => void; onAddText: () => void; onSelectLayer: (id: string) => void;
}) {
  const bg = scene.background;
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
      </Field>

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

      {scene.note && (
        <div className="text-[10px] text-muted-foreground rounded-md bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] p-2">
          <span className="uppercase tracking-wide text-[8px] mr-1">Direction</span>{scene.note}
        </div>
      )}

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
