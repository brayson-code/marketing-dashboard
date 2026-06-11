// The structured, editable "composition" behind a storyboard — what the visual
// scene editor manipulates and what Phase 2 will hand to HeyGen to render. The
// markdown storyboard stays the human-readable script; this is the layout layer.
// Pure + dependency-free so it runs on the client. Persisted on the draft at
// metadata.composition; seeded from the parsed storyboard the first time the
// editor opens.

import type { Storyboard } from './hyperframes-storyboard';
import type { ClipCatalogEntry } from './hyperframes-clips';

/** Optional hooks for compositionFromStoryboard — resolve a scene's clip ref to a real asset. */
export interface CompositionFromStoryboardOpts {
  /** Resolve a clip reference (id or name) to a Media-library asset, or null. */
  resolveClip?: (ref?: string | null) => ClipCatalogEntry | null;
}

export interface TextLayer {
  id: string;
  type: 'text';
  text: string;
  xPct: number;       // center X, 0–100 of frame width
  yPct: number;       // center Y, 0–100 of frame height
  widthPct: number;   // box width as % of frame width
  fontSize: number;   // px at a 1080px-wide reference (scaled in preview)
  color: string;
  align: 'left' | 'center' | 'right';
  weight: 400 | 600 | 800;
}

export interface SceneBackground {
  type: 'color' | 'image' | 'video';
  value: string;      // hex for color; URL for image/video (b-roll)
}

export interface CompositionScene {
  id: string;
  label?: string;     // "Hook" / "CTA" / undefined for numbered scenes
  startMs: number;
  endMs: number;
  background: SceneBackground;
  layers: TextLayer[];
  voiceover?: string; // the VO / audio line — not drawn, used for render + reference
  caption?: string;   // on-screen spoken words — rendered as karaoke-style captions
  note?: string;      // the agent's visual direction — an editor hint, not rendered
}

export interface Composition {
  version: 1;
  aspect: '9:16';
  scenes: CompositionScene[];
}

const DEFAULT_BG = '#0B0B0F';

export function newTextLayer(id: string, text = 'New text'): TextLayer {
  return { id, type: 'text', text, xPct: 50, yPct: 50, widthPct: 80, fontSize: 64, color: '#FFFFFF', align: 'center', weight: 800 };
}

export function newScene(id: string, startMs: number): CompositionScene {
  return { id, startMs, endMs: startMs + 3000, background: { type: 'color', value: DEFAULT_BG }, layers: [] };
}

// "0:01.5 – 0:04" → [1500, 4000]. Tolerant: returns what it can find.
function parseTimeRange(time?: string): { startMs?: number; endMs?: number } {
  if (!time) return {};
  const all = [...time.matchAll(/(\d+):(\d+(?:\.\d+)?)/g)];
  const toMs = (m: RegExpMatchArray) => (parseInt(m[1], 10) * 60 + parseFloat(m[2])) * 1000;
  if (all.length >= 2) return { startMs: toMs(all[0]), endMs: toMs(all[1]) };
  if (all.length === 1) return { startMs: toMs(all[0]) };
  return {};
}

export function compositionFromStoryboard(sb: Storyboard, opts: CompositionFromStoryboardOpts = {}): Composition {
  let n = 0;
  const sid = () => `s${++n}`;
  const resolveClip = opts.resolveClip;

  const build = (b: { label?: string; time?: string; text?: string; visual?: string; audio?: string; clip?: string }): CompositionScene => {
    const id = sid();
    const { startMs, endMs } = parseTimeRange(b.time);
    const layers: TextLayer[] = [];
    if (b.text && b.text.trim()) {
      layers.push({ ...newTextLayer(`${id}-t1`, b.text.trim()) });
    }
    // Captions = the spoken words. Seed from the VO line, stripping a leading
    // "VO:" and wrapping quotes so it reads as clean on-screen text.
    const caption = b.audio
      ? b.audio.replace(/^\s*VO:\s*/i, '').replace(/^["']|["']$/g, '').trim() || undefined
      : undefined;
    // When a scene references a real Media-library clip and the resolver finds it,
    // use that asset's URL as the scene background (video or image). Otherwise the
    // background stays the default color — identical to pre-clip behavior.
    const asset = resolveClip ? resolveClip(b.clip) : null;
    const background: SceneBackground = asset
      ? { type: asset.kind === 'video' ? 'video' : 'image', value: asset.url }
      : { type: 'color', value: DEFAULT_BG };
    return {
      id,
      label: b.label,
      startMs: startMs ?? 0,
      endMs: endMs ?? 0,
      background,
      layers,
      voiceover: b.audio,
      caption,
      note: b.visual,
    };
  };

  const scenes: CompositionScene[] = [];
  if (sb.hook) scenes.push(build({ label: 'Hook', text: sb.hook.onScreenText, visual: sb.hook.visual, audio: sb.hook.audio, clip: sb.hook.clip }));
  for (const s of sb.scenes) scenes.push(build({ time: s.time, text: s.onScreenText, visual: s.visual, audio: s.audio, clip: s.clip }));
  if (sb.cta && (sb.cta.onScreenText || sb.cta.visual)) scenes.push(build({ label: 'CTA', text: sb.cta.onScreenText, visual: sb.cta.visual, clip: sb.cta.clip }));
  if (scenes.length === 0) scenes.push(newScene(sid(), 0));

  // Fill in any missing/invalid timings sequentially so the timeline is sane.
  let cursor = 0;
  for (const s of scenes) {
    if (!Number.isFinite(s.startMs) || s.startMs < cursor) s.startMs = cursor;
    if (!Number.isFinite(s.endMs) || s.endMs <= s.startMs) s.endMs = s.startMs + 3000;
    cursor = s.endMs;
  }

  return { version: 1, aspect: '9:16', scenes };
}

// Narrowing guard for the value read off draft.metadata.composition.
export function isComposition(v: unknown): v is Composition {
  return !!v && typeof v === 'object' && Array.isArray((v as Composition).scenes);
}

export function formatMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  const remStr = Number.isInteger(rem) ? String(rem) : rem.toFixed(1);
  return `${m}:${remStr.padStart(rem < 10 ? 2 : 0, '0')}`;
}
