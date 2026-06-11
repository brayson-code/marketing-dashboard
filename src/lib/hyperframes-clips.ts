// Bridge between the tenant's Media library (tenant_assets) and the Hyperframes
// agent + renderer. The agent writes a storyboard that may reference real uploaded
// clips by id or name (b-roll / a-roll); this module builds the catalog the agent
// picks from, renders it into the generation prompt, and resolves a scene's clip
// reference back to the asset's real URL at render time. Tenant-scoped via the
// assets store (which already filters by tenantId()).

import { listAssets, type AssetRow } from './assets';

export interface ClipCatalogEntry {
  /** tenant_assets.id, as a string so id/name references compare uniformly. */
  id: string;
  /** Display name (filename) the agent can also reference by. */
  name: string;
  kind: 'video' | 'image';
  url: string;
  durationSec?: number;
  tags?: string[];
}

/**
 * Normalize an agent-provided clip reference for fuzzy matching: drop a file
 * extension, lowercase, and strip every non-alphanumeric char so "B-Roll_01.mp4",
 * "broll 01" and "BROLL01" all collapse to the same token.
 */
export function normalizeRef(ref: string): string {
  return ref
    .trim()
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, '') // strip a trailing file extension
    .replace(/[^a-z0-9]+/g, '');
}

/**
 * Read the active tenant's video/image assets and return a compact catalog of
 * clips usable as b-roll / a-roll. Audio/doc assets are skipped (the assets store
 * only stores 'video' | 'image' today, but we filter defensively).
 */
export async function buildClipCatalog(): Promise<ClipCatalogEntry[]> {
  const assets = await listAssets();
  return assets
    .filter((a): a is AssetRow & { kind: 'video' | 'image' } => a.kind === 'video' || a.kind === 'image')
    .map((a) => ({
      id: String(a.id),
      name: (a.name ?? `clip-${a.id}`).trim(),
      kind: a.kind,
      url: a.url,
      ...(a.duration_ms != null ? { durationSec: Math.round(a.duration_ms / 1000) } : {}),
    }));
}

/**
 * A COMPACT text block injected into the generation prompt so the agent can pick
 * real clips. Returns '' when the library is empty so nothing is injected and the
 * agent's behavior is unchanged.
 */
export function renderClipCatalogPrompt(catalog: ClipCatalogEntry[]): string {
  if (catalog.length === 0) return '';
  const lines = catalog.map((c) => {
    const dur = c.durationSec != null ? `, ${c.durationSec}s` : '';
    const tags = c.tags && c.tags.length ? ` — ${c.tags.join(', ')}` : '';
    return `[${c.id}] ${c.name} (${c.kind}${dur})${tags}`;
  });
  return [
    "## Tenant media library (real uploaded clips you may use)",
    'You may set a scene\'s clip field to one of these ids or names to splice the',
    "tenant's own footage instead of describing generic b-roll. a-roll = the",
    'talking-head / foreground spine; b-roll = supporting footage over the words.',
    'Use the id in brackets (preferred) or the exact name. Leave clip blank to',
    'describe a shot you have no footage for.',
    '',
    ...lines,
  ].join('\n');
}

/**
 * Build a resolver over a catalog. `resolveClip(ref)` matches by exact id, then
 * exact name, then normalizeRef() equality, then a startsWith/contains fallback.
 * Returns null for an empty or unmatched reference.
 */
export function makeClipResolver(
  catalog: ClipCatalogEntry[],
): (ref?: string | null) => ClipCatalogEntry | null {
  const byId = new Map<string, ClipCatalogEntry>();
  const byName = new Map<string, ClipCatalogEntry>();
  const byNorm = new Map<string, ClipCatalogEntry>();
  for (const c of catalog) {
    byId.set(c.id, c);
    byName.set(c.name.toLowerCase(), c);
    const norm = normalizeRef(c.name);
    if (norm && !byNorm.has(norm)) byNorm.set(norm, c);
  }

  return function resolveClip(ref?: string | null): ClipCatalogEntry | null {
    if (!ref) return null;
    const raw = ref.trim();
    if (!raw) return null;

    const exactId = byId.get(raw);
    if (exactId) return exactId;

    const exactName = byName.get(raw.toLowerCase());
    if (exactName) return exactName;

    const norm = normalizeRef(raw);
    if (norm) {
      const normHit = byNorm.get(norm);
      if (normHit) return normHit;

      // Last resort: a normalized startsWith / contains match against any clip.
      for (const c of catalog) {
        const cn = normalizeRef(c.name);
        if (cn && (cn.startsWith(norm) || norm.startsWith(cn) || cn.includes(norm) || norm.includes(cn))) {
          return c;
        }
      }
    }
    return null;
  };
}
