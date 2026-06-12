// Auto-build a RICH composition from a storyboard draft — the "agent upgrade"
// from the Hyperframes plan. The pipeline used to stop at the plain seed (one
// text layer + karaoke caption per scene); this module makes one forced-tool
// Sonnet call that art-directs the rich format on top of that seed: scene
// transitions, punch-in beats on the hook, b-roll splices from the tenant's
// REAL media library, stat/list/bar infographics for cited numbers, and a
// caption preset/accent. Agent-first editing — the user refines, never builds.
//
// Safety model (why this can't corrupt a render):
// - The model never re-emits the base composition. It returns an ENRICHMENT
//   layer keyed by the seed's scene ids, which we merge onto the seed ourselves
//   — ids, ms timings, text layers, backgrounds and captions are structurally
//   guaranteed to survive untouched.
// - B-roll is referenced by asset id/name from the library catalog and resolved
//   through the existing clip resolver. An unmatched (or invented) reference is
//   dropped — a composition can never point at a URL we don't own.
// - The merged result goes through normalizeComposition (junk-tolerant, drops
//   invalid rich fields), and on ANY failure — no key, API error, no tool call,
//   validation miss — we fall back to the plain seed, so the editor ALWAYS opens.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { getDraft } from './drafts';
import { parseStoryboard } from './hyperframes-storyboard';
import { buildClipCatalog, makeClipResolver, type ClipCatalogEntry } from './hyperframes-clips';
import { getCompanyPlaybookMarkdown } from './company-playbook';
import {
  compositionFromStoryboard, isComposition, normalizeComposition, RICH_FORMAT_GUIDE,
  type BrollOverlay, type CaptionStyle, type Composition, type CompositionScene,
  type Infographic, type SceneTransition,
} from './hyperframes-composition';

export interface AutobuildResult {
  composition: Composition;
  /** 'agent' = the rich build validated; 'seed' = plain-seed fallback. */
  source: 'agent' | 'seed';
  /** Why the rich build fell back (only set when source === 'seed'). */
  error?: string;
}

// ── Model output shape (loose on purpose — the merge + normalizer validate) ──
interface DesignBroll { asset?: unknown; start?: unknown; duration?: unknown; frame?: unknown; anchor?: unknown }
interface DesignScene { id?: unknown; transition_in?: unknown; punches?: unknown; broll?: unknown; infographics?: unknown }
interface ReelDesign { caption_style?: unknown; scenes?: unknown }

// Forced tool. Field semantics/units live in RICH_FORMAT_GUIDE (injected into
// the system prompt) — the schema here only shapes the JSON, it doesn't re-document it.
const DESIGN_TOOL: Anthropic.Messages.Tool = {
  name: 'emit_reel_design',
  description:
    'Emit the rich-format design layer for this reel: caption styling plus per-scene transitions, ' +
    'punch-in beats, b-roll splices (by media-library asset id) and infographics.',
  input_schema: {
    type: 'object',
    properties: {
      caption_style: {
        type: 'object',
        properties: {
          preset: { type: 'string', enum: ['classic', 'boxed', 'highlight'] },
          accent_color: { type: 'string', description: 'hex like #FACC15 — use a brand color when the playbook names one' },
          size: { type: 'string', enum: ['md', 'lg'] },
        },
        required: ['preset'],
      },
      scenes: {
        type: 'array',
        description: 'One entry per scene you enrich, keyed by its id from the base composition. Scenes you skip stay plain.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'a scene id from the base composition, e.g. "s1"' },
            transition_in: { type: 'string', enum: ['cut', 'punch_in', 'whip', 'pop'] },
            punches: { type: 'array', items: { type: 'number' }, description: 'punch-in beats, seconds after scene start' },
            broll: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  asset: { type: 'string', description: 'a media-library asset id (preferred) or exact filename — NEVER a URL' },
                  start: { type: 'number' },
                  duration: { type: 'number' },
                  frame: { type: 'string', enum: ['full', 'inset'] },
                  anchor: { type: 'string', enum: ['top', 'bottom'] },
                },
                required: ['asset', 'start', 'duration', 'frame'],
              },
            },
            infographics: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  kind: { type: 'string', enum: ['stat', 'list', 'bar'] },
                  start: { type: 'number' },
                  duration: { type: 'number' },
                  xPct: { type: 'number' },
                  yPct: { type: 'number' },
                  widthPct: { type: 'number' },
                  data: { type: 'object', description: 'stat:{value,label} · list:{items[]} · bar:{label,pct,caption?} — see the format guide' },
                },
                required: ['kind', 'start', 'xPct', 'yPct', 'widthPct', 'data'],
              },
            },
          },
          required: ['id'],
        },
      },
    },
    required: ['scenes'],
  },
};

const SYSTEM = `You art-direct Hormozi-style short-form reels: hard hook, fast cuts, punch-in energy, spliced b-roll, bold stat callouts. Never stock footage, never corporate decoration.
You are handed a BASE composition (scene ids + timings are locked — you cannot change them), the storyboard it came from, and the tenant's real media library.
Add the rich layer only where it raises retention — not on every scene:
- Hook scene: a punch_in or whip entrance, and/or 1–2 punch beats on the strongest words.
- B-roll: when a scene's visual direction (or a [broll: …] hint) matches a library clip's filename/label keywords, splice it — frame "full" for a hard cutaway, "inset" for proof shown over the words. Reference assets ONLY by their [id] or exact name from the library list; if nothing matches, emit no b-roll for that scene. Never invent asset references.
- Stat infographic whenever the script cites a number (or a [stat: value — label] hint). Keep infographics clear of the caption band: yPct <= 60.
- caption_style: boxed or highlight suits this style; take accent_color from the company playbook when it names brand colors, otherwise omit it.
All intra-scene times (punches, broll start/duration, infographic start/duration) are SECONDS after that scene's start and must fit inside the scene's duration.

Format reference (the schema your design merges into):
${RICH_FORMAT_GUIDE}

Always call emit_reel_design.`;

// Compact per-scene digest — ids + locked timings + what's said/shown, so the
// model can place beats without us re-sending the whole composition JSON.
function sceneDigest(seed: Composition): string {
  return seed.scenes.map((s) => {
    const dur = Math.round((s.endMs - s.startMs) / 100) / 10;
    return `- ${s.id}${s.label ? ` (${s.label})` : ''} · ${s.startMs / 1000}–${s.endMs / 1000}s (dur ${dur}s)` +
      (s.caption ? ` · spoken: "${s.caption}"` : '') +
      (s.note ? ` · visual: ${s.note}` : '');
  }).join('\n');
}

function libraryBlock(catalog: ClipCatalogEntry[]): string {
  if (catalog.length === 0) return 'Media library: EMPTY — emit no broll entries.';
  const lines = catalog.map((c) =>
    `[${c.id}] ${c.name} (${c.kind}${c.durationSec != null ? `, ${c.durationSec}s` : ''})`);
  return 'Media library (set broll.asset to an [id] or exact name; videos are the b-roll candidates):\n' + lines.join('\n');
}

// Merge the model's enrichment layer onto the seed. Only rich fields are added;
// everything the editor already owns passes through untouched. The normalizer
// is the real validator — invalid entries are dropped field-by-field.
function mergeDesign(
  seed: Composition,
  design: ReelDesign,
  resolveClip: (ref?: string | null) => ClipCatalogEntry | null,
): Composition {
  const byId = new Map<string, DesignScene>();
  for (const d of Array.isArray(design.scenes) ? (design.scenes as DesignScene[]) : []) {
    if (d && typeof d.id === 'string') byId.set(d.id, d);
  }

  const toOverlay = (v: unknown): BrollOverlay | null => {
    const b = v as DesignBroll | null;
    if (!b || typeof b.asset !== 'string') return null;
    const hit = resolveClip(b.asset);
    if (!hit) return null; // unmatched / invented reference — drop, never guess a URL
    return {
      kind: 'broll',
      src: hit.url,
      start: Number(b.start),       // non-finite → dropped by normalizeComposition
      duration: Number(b.duration),
      fit: 'cover',
      frame: b.frame === 'inset' ? 'inset' : 'full',
      ...(b.anchor === 'bottom' ? { anchor: 'bottom' as const } : {}),
    };
  };

  const scenes: CompositionScene[] = seed.scenes.map((s) => {
    const d = byId.get(s.id);
    if (!d) return s;
    const out: CompositionScene = { ...s };
    if (typeof d.transition_in === 'string') out.transition_in = d.transition_in as SceneTransition;
    if (Array.isArray(d.punches)) out.punches = d.punches as number[];
    const overlays = (Array.isArray(d.broll) ? d.broll : []).map(toOverlay).filter((o): o is BrollOverlay => !!o);
    if (overlays.length) out.overlays = overlays;
    if (Array.isArray(d.infographics)) out.infographics = d.infographics as Infographic[];
    return out;
  });

  return normalizeComposition({
    ...seed,
    scenes,
    ...(design.caption_style && typeof design.caption_style === 'object'
      ? { caption_style: design.caption_style as CaptionStyle }
      : {}),
  });
}

/**
 * Build a rich composition for a storyboard draft. Loads the draft, seeds the
 * plain composition exactly like the render route does (clip refs resolved
 * against the tenant's media library), then asks Sonnet for the rich layer.
 * NEVER throws on model problems — every failure returns the plain seed with
 * `source: 'seed'` so callers can still open the editor. Caller persists.
 */
export async function autobuildComposition(draftId: number): Promise<AutobuildResult> {
  const draft = await getDraft(draftId);
  if (!draft) throw new Error('Draft not found');

  const catalog = await buildClipCatalog();
  const resolveClip = makeClipResolver(catalog);
  const seed = compositionFromStoryboard(parseStoryboard(draft.payload), { resolveClip });

  const apiKey = await getAnthropicKey();
  if (!apiKey) return { composition: seed, source: 'seed', error: NO_ANTHROPIC_KEY_MESSAGE };

  // Company playbook (brand voice/colors) — best-effort context, never blocks.
  const playbook = await getCompanyPlaybookMarkdown();

  const userMsg = [
    '# Storyboard (the script — honor its [broll: …] / [stat: …] hints)',
    draft.payload.trim().slice(0, 8000),
    '',
    '# Base composition scenes (locked ids + timings — enrich these)',
    sceneDigest(seed),
    '',
    `# ${libraryBlock(catalog)}`,
    ...(playbook ? ['', '# Company playbook (brand voice / colors)', playbook.trim().slice(0, 2000)] : []),
  ].join('\n');

  try {
    const client = new Anthropic({ apiKey, maxRetries: 3 });
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system: SYSTEM,
      tools: [DESIGN_TOOL],
      tool_choice: { type: 'tool', name: 'emit_reel_design' },
      messages: [{ role: 'user', content: userMsg }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_reel_design',
    );
    if (!use) return { composition: seed, source: 'seed', error: 'Model returned no design' };

    const merged = mergeDesign(seed, use.input as ReelDesign, resolveClip);
    // Belt-and-braces: the merge is seed-anchored, so a scene-count mismatch
    // means something went structurally wrong — fall back rather than persist.
    if (!isComposition(merged) || merged.scenes.length !== seed.scenes.length) {
      return { composition: seed, source: 'seed', error: 'Design failed validation' };
    }
    return { composition: merged, source: 'agent' };
  } catch (e) {
    return { composition: seed, source: 'seed', error: (e as Error).message };
  }
}
