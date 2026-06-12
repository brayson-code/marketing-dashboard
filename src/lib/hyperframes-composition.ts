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

// ── Rich format (phase 2) — every field below is OPTIONAL and defaulted, so ──
// ── compositions persisted before these existed render exactly as they did. ──

/** How a scene enters at its start. 'cut' = today's behavior (no tween). */
export const SCENE_TRANSITIONS = ['cut', 'punch_in', 'whip', 'pop'] as const;
export type SceneTransition = (typeof SCENE_TRANSITIONS)[number];

/** A b-roll splice over the scene: full-bleed cutaway or rounded picture-in-picture. */
export interface BrollOverlay {
  kind: 'broll';
  src: string;               // tenant asset URL (video; image URLs also accepted)
  start: number;             // seconds AFTER the scene's start
  duration: number;          // seconds (clamped to the scene's end at render)
  fit: 'cover';
  frame: 'full' | 'inset';   // full = cutaway covering the background; inset = PiP (~62% width)
  anchor?: 'top' | 'bottom'; // inset only; default 'top'
}

/** Shared infographic placement — same coordinate system as TextLayer. */
interface InfographicBase {
  id?: string;        // optional; the renderer generates one when absent
  start: number;      // seconds AFTER the scene's start
  duration?: number;  // seconds; defaults to the rest of the scene
  xPct: number;       // center X, 0–100 of frame width
  yPct: number;       // center Y, 0–100 of frame height
  widthPct: number;   // box width as % of frame width
}
export interface StatInfographic extends InfographicBase {
  kind: 'stat';
  data: { value: string; label: string };          // big bold number pop
}
export interface ListInfographic extends InfographicBase {
  kind: 'list';
  data: { items: string[] };                        // staggered check-line reveals
}
export interface BarInfographic extends InfographicBase {
  kind: 'bar';
  data: { label: string; pct: number; caption?: string }; // animated fill, pct 0–100
}
export type Infographic = StatInfographic | ListInfographic | BarInfographic;

/** Karaoke caption band styling. Absent (or classic/md) = today's exact look. */
export interface CaptionStyle {
  preset: 'classic' | 'boxed' | 'highlight'; // boxed = dark word pills; highlight = accent pill on the popping word
  accent_color?: string;                     // hex; also colors infographics. Default DEFAULT_ACCENT.
  size?: 'md' | 'lg';                        // md = 62px (today), lg = 76px
}

/** Accent used by caption highlight + infographics when no accent_color is set. */
export const DEFAULT_ACCENT = '#FACC15';

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
  transition_in?: SceneTransition; // entrance at the scene cut; default 'cut'
  punches?: number[];              // punch-in beats (s after scene start): bg scale bump ~6% + fast settle
  overlays?: BrollOverlay[];       // b-roll splices over this scene
  infographics?: Infographic[];    // stat / list / bar components
}

export interface Composition {
  version: 1;
  aspect: '9:16';
  scenes: CompositionScene[];
  caption_style?: CaptionStyle; // absent = classic karaoke band (today's look)
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

// ── Rich-format normalization ────────────────────────────────────────────────
// Agents (and old persisted data) hand us loose JSON; sanitize the NEW fields
// only — never touch ids/timing/layers/backgrounds, so a pre-rich composition
// passes through byte-identical. Invalid entries are dropped, not "fixed", so a
// half-formed overlay can't corrupt a render. Returns a new object.

const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function normalizeOverlay(v: unknown): BrollOverlay | null {
  const o = v as Partial<BrollOverlay> | null;
  if (!o || o.kind !== 'broll' || typeof o.src !== 'string' || !o.src.trim()) return null;
  if (!isFiniteNum(o.start) || o.start < 0 || !isFiniteNum(o.duration) || o.duration <= 0) return null;
  return {
    kind: 'broll',
    src: o.src.trim(),
    start: o.start,
    duration: o.duration,
    fit: 'cover',
    frame: o.frame === 'inset' ? 'inset' : 'full',
    ...(o.anchor === 'bottom' ? { anchor: 'bottom' as const } : {}),
  };
}

function normalizeInfographic(v: unknown): Infographic | null {
  const g = v as Partial<Infographic> & { data?: Record<string, unknown> } | null;
  if (!g || !g.data || !isFiniteNum(g.start) || g.start < 0) return null;
  if (!isFiniteNum(g.xPct) || !isFiniteNum(g.yPct) || !isFiniteNum(g.widthPct)) return null;
  const base = {
    ...(typeof g.id === 'string' && g.id ? { id: g.id } : {}),
    start: g.start,
    ...(isFiniteNum(g.duration) && g.duration > 0 ? { duration: g.duration } : {}),
    xPct: clampPct(g.xPct),
    yPct: clampPct(g.yPct),
    widthPct: Math.max(5, clampPct(g.widthPct)),
  };
  if (g.kind === 'stat') {
    const { value, label } = g.data as { value?: unknown; label?: unknown };
    if (typeof value !== 'string' || !value.trim()) return null;
    return { kind: 'stat', ...base, data: { value: value.trim(), label: typeof label === 'string' ? label.trim() : '' } };
  }
  if (g.kind === 'list') {
    const items = Array.isArray((g.data as { items?: unknown }).items)
      ? ((g.data as { items: unknown[] }).items.filter((i): i is string => typeof i === 'string' && !!i.trim()))
      : [];
    if (items.length === 0) return null;
    return { kind: 'list', ...base, data: { items: items.map((i) => i.trim()) } };
  }
  if (g.kind === 'bar') {
    const { label, pct, caption } = g.data as { label?: unknown; pct?: unknown; caption?: unknown };
    if (typeof label !== 'string' || !isFiniteNum(pct)) return null;
    return {
      kind: 'bar',
      ...base,
      data: { label: label.trim(), pct: clampPct(pct), ...(typeof caption === 'string' && caption.trim() ? { caption: caption.trim() } : {}) },
    };
  }
  return null;
}

function normalizeCaptionStyle(v: unknown): CaptionStyle | undefined {
  const c = v as Partial<CaptionStyle> | null;
  if (!c || typeof c !== 'object') return undefined;
  const preset = c.preset === 'boxed' || c.preset === 'highlight' ? c.preset : 'classic';
  return {
    preset,
    ...(typeof c.accent_color === 'string' && c.accent_color.trim() ? { accent_color: c.accent_color.trim() } : {}),
    ...(c.size === 'lg' ? { size: 'lg' as const } : {}),
  };
}

/** Sanitize the rich-format fields of a composition (see note above). */
export function normalizeComposition(comp: Composition): Composition {
  return {
    ...comp,
    ...(comp.caption_style !== undefined ? { caption_style: normalizeCaptionStyle(comp.caption_style) } : {}),
    scenes: comp.scenes.map((s) => {
      const out: CompositionScene = { ...s };
      if (out.transition_in !== undefined && !SCENE_TRANSITIONS.includes(out.transition_in)) delete out.transition_in;
      if (out.punches !== undefined) {
        const p = (Array.isArray(out.punches) ? out.punches : []).filter((n) => isFiniteNum(n) && n > 0).sort((a, b) => a - b);
        if (p.length) out.punches = p; else delete out.punches;
      }
      if (out.overlays !== undefined) {
        const o = (Array.isArray(out.overlays) ? out.overlays : []).map(normalizeOverlay).filter((x): x is BrollOverlay => !!x);
        if (o.length) out.overlays = o; else delete out.overlays;
      }
      if (out.infographics !== undefined) {
        const g = (Array.isArray(out.infographics) ? out.infographics : []).map(normalizeInfographic).filter((x): x is Infographic => !!x);
        if (g.length) out.infographics = g; else delete out.infographics;
      }
      return out;
    }),
  };
}

// ── Agent-facing schema guide ────────────────────────────────────────────────
// The single canonical description of the composition format. The hyperframes
// agent prompt injects this so generated JSON matches what the renderer reads.
// Keep it tight: every field, its unit, and its default — nothing else.
export const RICH_FORMAT_GUIDE = `Hyperframes composition JSON (draft.metadata.composition). All "rich" fields are optional — omit for a plain scene.
{ version:1, aspect:"9:16", caption_style?:CaptionStyle, scenes:[Scene] }
Scene: { id, label?, startMs, endMs (ms on the reel timeline), background:{ type:"color"|"image"|"video", value: "#hex" or asset URL },
  layers:[Text], voiceover? (VO line, not drawn), caption? (spoken words -> karaoke word-pop band at bottom), note? (direction, not rendered),
  transition_in?: "cut"(default) | "punch_in"(fast scale hit 1->1.08->settle) | "whip"(x-snap + blur) | "pop"(scale .92->1 overshoot),
  punches?: [seconds after scene start] — each beat bumps the background scale ~6% with a fast settle (fast-cut feel, same shot),
  overlays?: [{ kind:"broll", src: asset URL (video preferred; image ok), start, duration (seconds after scene start; clamped to scene),
    fit:"cover", frame:"full"(full-bleed cutaway over the background; text+captions stay on top) | "inset"(rounded PiP ~62% width),
    anchor?: "top"(default)|"bottom" — inset placement }],
  infographics?: [{ kind:"stat"|"list"|"bar", start, duration? (seconds after scene start; default = rest of scene),
    xPct, yPct (center, 0-100), widthPct (box width % of frame), data }]
    stat data: { value:"83%", label:"short context" } — big accent number pop
    list data: { items:["...", "..."] } — staggered ✓-line reveals (3-5 short items)
    bar data: { label:"...", pct:0-100, caption?:"..." } — animated fill }
Text: { id, type:"text", text, xPct, yPct (center, 0-100), widthPct, fontSize (px at 1080w), color:"#hex", align:"left"|"center"|"right", weight:400|600|800 }
CaptionStyle: { preset:"classic"(default) | "boxed"(dark pill behind every word) | "highlight"(accent pill on the word as it pops),
  accent_color?: "#hex" (default ${DEFAULT_ACCENT}; also colors infographics), size?: "md"(62px, default)|"lg"(76px) }
Units: startMs/endMs are MILLISECONDS on the reel timeline; punches / overlay.start+duration / infographic.start+duration are SECONDS relative to their scene's start.`;

export function formatMs(ms: number): string {
  const s = ms / 1000;
  const m = Math.floor(s / 60);
  const rem = s - m * 60;
  const remStr = Number.isInteger(rem) ? String(rem) : rem.toFixed(1);
  return `${m}:${remStr.padStart(rem < 10 ? 2 : 0, '0')}`;
}
