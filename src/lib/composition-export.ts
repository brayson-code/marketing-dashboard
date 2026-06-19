// NLE export — turns a Hyperframes Composition into editor-grade interchange files:
//   • FCPXML 1.11 (Final Cut Pro X XML) — imported by Final Cut, Premiere Pro AND
//     DaVinci Resolve. This is the priority format: it carries backgrounds (as
//     media assets), text layers and captions (as <title>s).
//   • CMX3600 EDL — a simple, universal cut list (one event per scene).
//
// PURE + dependency-light: string building only, no imports beyond the Composition
// types. Reads the normalized composition; never mutates it. The render/HeyGen path
// is untouched — this is an additive, read-only projection of the composition.
//
// Coordinate systems:
//   Our system  — xPct/yPct are 0–100 from the TOP-LEFT, fontSize px at a 1080px-wide ref.
//   FCP system  — position is points from the CENTER, +X right, +Y UP; canvas is the
//                 sequence size (1080×1920 for our 9:16 reels).
//
// Phase-1 boundary: backgrounds + text layers + captions are mapped. Infographics,
// overlays (b-roll), punches and transitions are intentionally NOT mapped — FCPXML
// has no clean primitive for our custom components and emitting them risks an invalid
// document. They remain in the composition; export is the bg + text + caption layers.

import type { Composition, CompositionScene, TextLayer } from './hyperframes-composition';

export interface ExportOpts {
  title?: string; // project/event name; default 'Hyperframes reel'
  fps?: number;   // timeline frame rate; default 30
}

// 9:16 vertical reel canvas.
const FRAME_W = 1080;
const FRAME_H = 1920;
const DEFAULT_FPS = 30;
const DEFAULT_TITLE = 'Hyperframes reel';

// ── small pure helpers ───────────────────────────────────────────────────────

/** XML-escape text / attribute values. */
function xml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Clamp + integer-ize a millisecond value to >= 0. */
function ms0(n: unknown): number {
  return finite(n) && n > 0 ? Math.round(n) : 0;
}

/**
 * ms → FCPXML rational time string at `fps`, on a stable timebase (den = 100*fps,
 * e.g. 30fps → "/3000s"). frames are snapped so all times are frame-aligned.
 * A whole-second value reduces to "<n>s".
 */
function rat(ms: number, fps: number): string {
  const den = fps * 100; // e.g. 3000 for 30fps
  const frames = Math.round((ms / 1000) * fps);
  const num = frames * 100; // frames * (den/fps)
  if (num === 0) return '0s';
  if (num % den === 0) return `${num / den}s`;
  return `${num}/${den}s`;
}

/** seconds → same rational string. */
function rats(seconds: number, fps: number): string {
  return rat(seconds * 1000, fps);
}

/** ms → SMPTE non-drop timecode "HH:MM:SS:FF" at `fps`. */
function tc(ms: number, fps: number): string {
  const totalFrames = Math.round((ms / 1000) * fps);
  const f = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60) % 60;
  const h = Math.floor(totalSeconds / 3600);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${p2(h)}:${p2(m)}:${p2(s)}:${p2(f)}`;
}

/** "#RRGGBB" (or "#RGB") → FCP fontColor "R G B A" as 0–1 floats. Defaults to white. */
function hexToRgba01(hex: string): string {
  let h = (hex || '').trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return '1 1 1 1';
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const f = (n: number) => (Math.round(n * 1e6) / 1e6).toString();
  return `${f(r)} ${f(g)} ${f(b)} 1`;
}

/** TextLayer.weight (400/600/800) → FCP fontFace name. */
function weightToFace(weight: number): string {
  if (weight >= 800) return 'Bold';
  if (weight >= 600) return 'Semibold';
  return 'Regular';
}

/** xPct/yPct (top-left origin, 0–100) → FCP center-origin points "X Y" (Y up-positive). */
function pctToFcpPosition(xPct: number, yPct: number): string {
  const x = ((clamp01to100(xPct) - 50) / 100) * FRAME_W;
  const y = ((50 - clamp01to100(yPct)) / 100) * FRAME_H;
  const r = (n: number) => (Math.round(n * 100) / 100).toString();
  return `${r(x)} ${r(y)}`;
}

const clamp01to100 = (n: unknown): number => (finite(n) ? Math.max(0, Math.min(100, n)) : 50);

/** Last path segment of a URL, for human-readable clip names. */
function basename(url: string): string {
  try {
    const u = url.split('?')[0].split('#')[0];
    const seg = u.split('/').filter(Boolean).pop();
    return seg ? decodeURIComponent(seg) : url;
  } catch {
    return url;
  }
}

/** First non-empty line of a string (for clip/title names). */
function firstLine(s: string): string {
  const line = (s || '').split('\n').map((l) => l.trim()).find((l) => !!l);
  return line || '';
}

// ── per-scene helpers ────────────────────────────────────────────────────────

/** Normalized scene timing — duration is always > 0 so spine offsets are sane. */
function sceneTiming(scene: CompositionScene): { startMs: number; durMs: number; endMs: number } {
  const startMs = ms0(scene.startMs);
  let endMs = ms0(scene.endMs);
  if (endMs <= startMs) endMs = startMs + 3000; // mirror the editor's 3s default
  return { startMs, durMs: endMs - startMs, endMs };
}

// ── FCPXML ───────────────────────────────────────────────────────────────────

/**
 * Convert a Composition → a minimal-but-valid FCPXML 1.11 document that Final Cut,
 * Premiere Pro and DaVinci Resolve will import. Backgrounds become media assets
 * (image → <video>, video → <asset-clip>; color-only scenes become a <gap>), and
 * each text layer + the spoken caption becomes a connected <title>.
 */
export function compositionToFcpxml(comp: Composition, opts: ExportOpts = {}): string {
  const fps = finite(opts.fps) && opts.fps! > 0 ? Math.round(opts.fps!) : DEFAULT_FPS;
  const title = (opts.title && opts.title.trim()) || DEFAULT_TITLE;
  const scenes = Array.isArray(comp.scenes) ? comp.scenes : [];

  // Sequence total = end of the last scene (fallback 0).
  const totalMs = scenes.reduce((max, s) => Math.max(max, sceneTiming(s).endMs), 0);

  // ── resources ──
  // r1 = format, r2 = Basic Title effect. Media assets start at r3.
  const FORMAT_ID = 'r1';
  const TITLE_EFFECT_ID = 'r2';
  let resSeq = 3;
  const nextResId = () => `r${resSeq++}`;

  // De-dupe assets by URL so the same media is declared once.
  const assetByUrl = new Map<string, { id: string; kind: 'image' | 'video'; url: string; durMs: number }>();
  const assetDecls: string[] = [];

  const ensureAsset = (url: string, kind: 'image' | 'video', durMs: number): string => {
    const existing = assetByUrl.get(url);
    if (existing) {
      // Keep the longest duration seen so the asset spans every use.
      if (durMs > existing.durMs) existing.durMs = durMs;
      return existing.id;
    }
    const id = nextResId();
    assetByUrl.set(url, { id, kind, url, durMs });
    return id;
  };

  // Build the spine in one pass; collect the assets we reference as we go.
  type SpineEntry = { sceneIdx: number; bg: string; titles: string[] };
  const spineEntries: SpineEntry[] = [];

  scenes.forEach((scene, i) => {
    const { startMs, durMs } = sceneTiming(scene);
    const offset = rat(startMs, fps);
    const duration = rat(durMs, fps);
    const bgType = scene.background?.type;
    const bgValue = typeof scene.background?.value === 'string' ? scene.background.value : '';

    // ── background ──
    let bg: string;
    if ((bgType === 'image' || bgType === 'video') && bgValue.trim()) {
      const kind = bgType === 'video' ? 'video' : 'image';
      const assetId = ensureAsset(bgValue.trim(), kind, durMs);
      const name = xml(scene.label || firstLine(scene.caption || '') || basename(bgValue.trim()) || `Scene ${i + 1}`);
      if (kind === 'image') {
        // Still images use <video> (no audio component to pull).
        bg = `        <video ref="${assetId}" offset="${offset}" name="${name}" start="0s" duration="${duration}">`;
      } else {
        bg = `        <asset-clip ref="${assetId}" offset="${offset}" name="${name}" start="0s" duration="${duration}">`;
      }
    } else {
      // Color-only (or empty) scene → a gap holds the timeline position; the color is
      // preserved in a note so it is not silently lost.
      const colorNote = bgType === 'color' && bgValue ? `\n          <note>background color ${xml(bgValue)}</note>` : '';
      bg = `        <gap offset="${offset}" name="${xml(scene.label || `Scene ${i + 1}`)}" duration="${duration}">${colorNote}`;
    }

    // ── titles: each text layer + the caption become connected <title>s on lanes ──
    const titles: string[] = [];
    let lane = 1;

    const emitTitle = (
      text: string,
      opts2: { fontSize: number; weight: number; color: string; align: TextLayer['align']; xPct: number; yPct: number },
    ) => {
      const tsId = `ts_${i + 1}_${lane}`;
      const fontColor = hexToRgba01(opts2.color);
      const fontFace = weightToFace(opts2.weight);
      const alignment = opts2.align === 'left' || opts2.align === 'right' ? opts2.align : 'center';
      const position = pctToFcpPosition(opts2.xPct, opts2.yPct);
      titles.push(
        [
          `          <title ref="${TITLE_EFFECT_ID}" lane="${lane}" offset="${offset}" name="${xml(firstLine(text) || 'Title')}" duration="${duration}" start="0s">`,
          `            <text>`,
          `              <text-style ref="${tsId}">${xml(text)}</text-style>`,
          `            </text>`,
          `            <text-style-def id="${tsId}">`,
          `              <text-style font="Helvetica Neue" fontSize="${Math.round(opts2.fontSize)}" fontFace="${fontFace}" fontColor="${fontColor}" alignment="${alignment}"/>`,
          `            </text-style-def>`,
          `            <adjust-transform position="${position}"/>`,
          `          </title>`,
        ].join('\n'),
      );
      lane += 1;
    };

    // Author-placed text layers.
    for (const layer of Array.isArray(scene.layers) ? scene.layers : []) {
      if (!layer || layer.type !== 'text' || typeof layer.text !== 'string' || !layer.text.trim()) continue;
      emitTitle(layer.text, {
        fontSize: finite(layer.fontSize) ? layer.fontSize : 64,
        weight: finite(layer.weight) ? layer.weight : 800,
        color: typeof layer.color === 'string' ? layer.color : '#FFFFFF',
        align: layer.align,
        xPct: layer.xPct,
        yPct: layer.yPct,
      });
    }

    // Spoken caption → a bottom-anchored title so on-screen captions carry into the NLE.
    if (typeof scene.caption === 'string' && scene.caption.trim()) {
      const capSize = comp.caption_style?.size === 'lg' ? 76 : 62;
      const capColor = comp.caption_style?.accent_color && comp.caption_style.preset === 'highlight'
        ? '#FFFFFF' // keep the band readable; accent is a per-word treatment we don't model here
        : '#FFFFFF';
      emitTitle(scene.caption.trim(), {
        fontSize: capSize,
        weight: 800,
        color: capColor,
        align: 'center',
        xPct: 50,
        yPct: 85, // lower third
      });
    }

    spineEntries.push({ sceneIdx: i, bg, titles });
  });

  // Now that durations are finalized, emit asset resource declarations.
  for (const a of assetByUrl.values()) {
    const safeDur = a.durMs > 0 ? a.durMs : 3000;
    const audio = a.kind === 'video' ? `hasAudio="1" audioSources="1" audioChannels="2" ` : `hasAudio="0" `;
    assetDecls.push(
      [
        `    <asset id="${a.id}" name="${xml(basename(a.url))}" uid="${a.id}" start="0s" duration="${rat(safeDur, fps)}" hasVideo="1" ${audio}format="${FORMAT_ID}">`,
        `      <media-rep kind="original-media" src="${xml(a.url)}"/>`,
        `    </asset>`,
      ].join('\n'),
    );
  }

  // Assemble the spine: each scene = bg element with its titles nested inside, then close.
  const spineBody = spineEntries
    .map((e) => {
      const open = e.bg; // already an opening tag (ends without "/>")
      const closeTag = open.trimStart().startsWith('<video')
        ? '        </video>'
        : open.trimStart().startsWith('<asset-clip')
          ? '        </asset-clip>'
          : '        </gap>';
      return [open, ...e.titles, closeTag].join('\n');
    })
    .join('\n');

  const resourcesBody = [
    // Unnamed custom format — FCP, Premiere and Resolve all import a custom timeline by
    // its explicit width/height/frameDuration/colorSpace. We deliberately omit a `name`:
    // Final Cut rejects unknown FFVideoFormat* preset names (there is no built-in vertical
    // 1080×1920p preset), so a name would only narrow compatibility.
    `    <format id="${FORMAT_ID}" frameDuration="${rats(1 / fps, fps)}" width="${FRAME_W}" height="${FRAME_H}" colorSpace="1-1-1 (Rec. 709)"/>`,
    `    <effect id="${TITLE_EFFECT_ID}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`,
    ...assetDecls,
  ].join('\n');

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE fcpxml>`,
    `<fcpxml version="1.11">`,
    `  <resources>`,
    resourcesBody,
    `  </resources>`,
    `  <library>`,
    `    <event name="${xml(title)}">`,
    `      <project name="${xml(title)}">`,
    `        <sequence format="${FORMAT_ID}" duration="${rat(totalMs, fps)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
    `          <spine>`,
    spineBody,
    `          </spine>`,
    `        </sequence>`,
    `      </project>`,
    `    </event>`,
    `  </library>`,
    `</fcpxml>`,
    ``,
  ].join('\n');
}

// ── CMX3600 EDL ────────────────────────────────────────────────────────────────

/**
 * Convert a Composition → a CMX3600 EDL (simple cut list). One event per scene:
 * source in/out (clip length) + record in/out (timeline position), all as SMPTE
 * timecode. Each event carries a "FROM CLIP NAME" comment (scene label / bg basename)
 * and a caption/first-text comment for editor context. Secondary to FCPXML.
 */
export function compositionToEdl(comp: Composition, opts: ExportOpts = {}): string {
  const fps = finite(opts.fps) && opts.fps! > 0 ? Math.round(opts.fps!) : DEFAULT_FPS;
  const title = (opts.title && opts.title.trim()) || DEFAULT_TITLE;
  const scenes = Array.isArray(comp.scenes) ? comp.scenes : [];

  const lines: string[] = [];
  lines.push(`TITLE: ${title.replace(/[\r\n]+/g, ' ').slice(0, 70)}`);
  lines.push(`FCM: NON-DROP FRAME`);
  lines.push('');

  scenes.forEach((scene, i) => {
    const { startMs, durMs, endMs } = sceneTiming(scene);
    const event = String(i + 1).padStart(3, '0');
    const reel = 'AX'; // auxiliary source reel
    const srcIn = tc(0, fps);
    const srcOut = tc(durMs, fps);
    const recIn = tc(startMs, fps);
    const recOut = tc(endMs, fps);

    // 001  AX       V     C        srcIn srcOut recIn recOut
    lines.push(`${event}  ${reel.padEnd(7, ' ')}  V     C        ${srcIn} ${srcOut} ${recIn} ${recOut}`);

    const bgValue = typeof scene.background?.value === 'string' ? scene.background.value : '';
    const clipName =
      scene.label ||
      ((scene.background?.type === 'image' || scene.background?.type === 'video') && bgValue.trim()
        ? basename(bgValue.trim())
        : `Scene ${i + 1}`);
    lines.push(`* FROM CLIP NAME: ${clipName.replace(/[\r\n]+/g, ' ')}`);

    const context = firstLine(scene.caption || '') || firstLine(scene.layers?.[0]?.text || '');
    if (context) lines.push(`* ${context.replace(/[\r\n]+/g, ' ').slice(0, 120)}`);
    lines.push('');
  });

  return lines.join('\n');
}
