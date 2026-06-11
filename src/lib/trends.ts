// Trend Radar — a pure, agent-free aggregation over the tenant's recently
// analyzed competitor reels. Surfaces which winning patterns (REEL_TAGS) are
// hot right now and the top-performing reels in the window, plus the
// reel-analyst's own rolling "pulse" notes as a one-line read on the trend.
//
// NO agent cost: this is read-only SQL + in-JS folding. Single-tenant-scoped —
// every query filters tenant_id = tenantId() since the backend postgres role
// bypasses RLS (see db/client.ts header).
//
// We select the analysis jsonb + view metrics for the window in ONE query and
// fold in JS: that lets us attach example reelIds per tag AND build topReels
// (ordered by views) from the same rows, instead of two separate SQL
// aggregations fighting over ordering. Windows are small (recent analyzed
// reels), so this is cheap.

import { sql, tenantId } from './db/client';
import { REEL_TAGS } from './reel-tags';
import { getAgentPulse } from './agent-defs';

export interface TrendRadar {
  windowDays: number;
  analyzedCount: number;
  topTags: Array<{ slug: string; label: string; color: string; count: number; reelIds: number[] }>;
  topReels: Array<{
    id: number;
    url: string;
    thumbnail_url: string | null;
    caption: string | null;
    views: number | null;
    tags: string[];
  }>;
  pulse: string;
}

// Caps, tuned to the contract (~8 tags, ~8 reels, ~6 example reelIds per tag).
const MAX_TAGS = 8;
const MAX_REELS = 8;
const MAX_REEL_IDS_PER_TAG = 6;

// One row per analyzed reel in the window. analysis is the raw jsonb
// ({ teardown, hadSpokenText, tags?: string[] }); we read analysis->'tags'.
interface WindowRow {
  id: number;
  url: string;
  thumbnail_url: string | null;
  caption: string | null;
  views: number | null;
  analysis: { tags?: unknown } | null;
}

// Defensive: pull a clean string[] of REEL_TAG slugs from a reel's analysis.tags.
// Skips anything that isn't a known slug so unknown/garbage tokens never leak.
function reelTags(analysis: WindowRow['analysis']): string[] {
  const raw = analysis?.tags;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const t of raw) {
    if (typeof t === 'string' && REEL_TAGS[t] && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * Aggregate the trend radar for the current tenant over the last `days` days
 * (default 30). Never throws on empty/missing data — returns zeros/[]/'' so the
 * route can render an empty state.
 */
export async function getTrendRadar(opts?: { days?: number }): Promise<TrendRadar> {
  const days = Number(opts?.days);
  const windowDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 30;

  let rows: WindowRow[] = [];
  try {
    rows = (await sql()`
      SELECT id, url, caption, thumbnail_url,
             views::float8 AS views,
             analysis
      FROM public.competitor_reels
      WHERE tenant_id = ${tenantId()}
        AND status IN ('analyzed', 'scripted')
        AND created_at >= now() - make_interval(days => ${windowDays})
      ORDER BY views DESC NULLS LAST, created_at DESC
    `) as unknown as WindowRow[];
  } catch {
    rows = [];
  }

  const analyzedCount = rows.length;

  // ── topTags: count each slug across the window, keep up to ~6 example reelIds ──
  const tally = new Map<string, { count: number; reelIds: number[] }>();
  for (const r of rows) {
    for (const slug of reelTags(r.analysis)) {
      let entry = tally.get(slug);
      if (!entry) {
        entry = { count: 0, reelIds: [] };
        tally.set(slug, entry);
      }
      entry.count += 1;
      if (entry.reelIds.length < MAX_REEL_IDS_PER_TAG) entry.reelIds.push(r.id);
    }
  }

  const topTags = [...tally.entries()]
    .map(([slug, { count, reelIds }]) => ({
      slug,
      label: REEL_TAGS[slug].label,
      color: REEL_TAGS[slug].color,
      count,
      reelIds,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, MAX_TAGS);

  // ── topReels: rows already come back views-desc (nulls last); take the top ~8 ──
  const topReels = rows.slice(0, MAX_REELS).map((r) => ({
    id: r.id,
    url: r.url,
    thumbnail_url: r.thumbnail_url ?? null,
    caption: r.caption ?? null,
    views: r.views ?? null,
    tags: reelTags(r.analysis),
  }));

  // ── pulse: the reel-analyst's own rolling trend notes. Default '' on any miss. ──
  let pulse = '';
  try {
    pulse = (await getAgentPulse('reel-analyst')) || '';
  } catch {
    pulse = '';
  }

  return { windowDays, analyzedCount, topTags, topReels, pulse };
}
