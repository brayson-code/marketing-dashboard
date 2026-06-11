// Reel Intel pipeline — the orchestration glue over the Wave-1 primitives.
//
// One winning competitor reel → teardown → (optional) adapted KeyPlayers script.
// analyzeReel() drives a single reel end-to-end; runWatchlistDue() sweeps every
// due competitor, pulls their recent reels, and analyzes the top new performer(s).
//
// Everyone else imports analyzeReel / runWatchlistDue; this module owns the
// glue and never re-implements scraping, storage, or the agents.
//
// Tenant scoping is inherited: every helper called here (competitors.ts,
// drafts.ts, agent-defs.ts, subagent.ts) already scopes tenant_id = tenantId(),
// so the caller just needs to be inside tenant context (enterTenant) — which the
// API route handler establishes before calling in.
//
// TRANSCRIPTION POLICY (caption-first): the analysis text is caption + subtitles.
// Deepgram is NOT called by default. It only runs when REEL_TRANSCRIBE === 'on'
// AND the scraped reel has no subtitles AND a Deepgram key is configured. The
// reel-analyst's task always states whether spoken text was available.

import { scrapeReel, scrapeReels, scrapeProfileReels, type ReelData } from './apify';
import { transcribeUrl, getDeepgramKey } from './deepgram';
import {
  dueCompetitors,
  markChecked,
  upsertReel,
  updateReel,
  getReel,
  type Competitor,
  type ReelRow,
} from './competitors';
import { spawnSubAgent } from './subagent';
import { createDraft } from './drafts';
import { ensureBundledAgentRow } from './agent-defs';
import { parseReelTags } from './reel-tags';

// Map a scraped ReelData → upsertReel input. camelCase → snake_case, carrying the
// competitor_id and pipeline status. subtitles isn't a ReelRow column — it feeds
// the analysis text only, so it's intentionally not mapped here.
function reelDataToUpsert(
  data: ReelData,
  competitorId: number | undefined,
  status: string,
): Partial<ReelRow> & { url: string } {
  return {
    competitor_id: competitorId ?? null,
    external_id: data.externalId || null,
    url: data.url,
    caption: data.caption || null,
    views: data.views,
    likes: data.likes,
    comments: data.comments,
    posted_at: data.postedAt,
    thumbnail_url: data.thumbnailUrl,
    video_url: data.videoUrl,
    status,
  };
}

// Decide the spoken-text input for the analysis. Caption-first: prefer the
// scraped subtitles; only fall back to Deepgram when the env flag is on, there
// are no subtitles, a video URL exists, and a key is configured. Any Deepgram
// failure degrades gracefully to "no spoken text".
async function resolveSpokenText(data: ReelData): Promise<string> {
  const subtitles = data.subtitles?.trim();
  if (subtitles) return subtitles;

  if (process.env.REEL_TRANSCRIBE !== 'on') return '';
  if (!data.videoUrl) return '';
  try {
    const key = await getDeepgramKey();
    if (!key) return '';
    const transcript = await transcribeUrl(data.videoUrl);
    return transcript.trim();
  } catch (err) {
    console.error('[reel-intel] deepgram transcribe failed:', (err as Error).message);
    return '';
  }
}

// Compose the reel-analyst task: handle + metrics + caption + spoken text. Kept
// as a readable brief; the agent does the teardown.
function buildAnalystTask(data: ReelData, spokenText: string, competitorId?: number): string {
  const handle = (() => {
    const m = data.url.match(/instagram\.com\/([^/?#]+)/i);
    return m && m[1] && !/^(reel|reels|p|tv)$/i.test(m[1]) ? `@${m[1]}` : 'unknown';
  })();
  const metric = (label: string, v: number | null) => `${label}: ${v != null ? v.toLocaleString() : 'unknown'}`;
  const lines = [
    'Reverse-engineer why this short-form video performed. Extract the winning hook, key phrases, structure, and an adaptable angle.',
    '',
    `Handle: ${handle}`,
    `URL: ${data.url}`,
    competitorId != null ? `Competitor id: ${competitorId}` : null,
    [metric('Views', data.views), metric('Likes', data.likes), metric('Comments', data.comments)].join('  ·  '),
    '',
    '## Caption',
    data.caption?.trim() || '(no caption)',
    '',
    '## Spoken text (transcript / subtitles)',
    spokenText || 'none available — analyze from caption + metrics only.',
  ].filter((l) => l !== null);
  return lines.join('\n');
}

export interface AnalyzeInput {
  url: string;
  competitorId?: number;
  withScript?: boolean;
  deep?: boolean; // opt-in: Sonnet + web_search trend research (default = cheap Haiku, no tools)
}

// The reel's live lifecycle status, surfaced to the UI's Live Analysis Board:
//   fetched → analyzing → analyzed → [scripting → scripted] (or → error)
// 'fetched' = scraped + stored, queued for teardown; 'analyzing' = reel-analyst
// running; 'scripting' = hyperframes-agent writing the script. The transient
// states let the board show each agent pulling data in real time.
export const LIVE_REEL_STATUSES = ['fetched', 'analyzing', 'scripting'] as const;
export function isLiveStatus(status: string): boolean {
  return (LIVE_REEL_STATUSES as readonly string[]).includes(status);
}

/**
 * Phase 1 — scrape + store as 'fetched'. Fast (one Apify call), so an API route
 * can return the pending reel immediately and run the slow teardown in the
 * background. Returns the row PLUS the scraped data (phase 2 needs the subtitles,
 * which aren't a stored column).
 */
export async function scrapeAndStore(
  input: { url: string; competitorId?: number },
): Promise<{ reel: ReelRow; data: ReelData }> {
  const data = await scrapeReel(input.url);
  const reel = await upsertReel(reelDataToUpsert(data, input.competitorId, 'fetched'));
  return { reel, data };
}

/**
 * Batch version of scrapeAndStore — scrapes ALL urls in ONE Apify run (one boot,
 * one charge) and stores each as 'fetched'. Returns one {reel,data} per reel the
 * actor actually returned. Lets the analyze route paste-many: one scrape, then
 * fan the teardowns out concurrently in the background.
 */
export async function scrapeAndStoreMany(
  input: { urls: string[]; competitorId?: number },
): Promise<Array<{ reel: ReelRow; data: ReelData }>> {
  const datas = await scrapeReels(input.urls);
  const out: Array<{ reel: ReelRow; data: ReelData }> = [];
  for (const data of datas) {
    if (!data.url) continue;
    try {
      const reel = await upsertReel(reelDataToUpsert(data, input.competitorId, 'fetched'));
      out.push({ reel, data });
    } catch (err) {
      console.error(`[reel-intel] upsert failed for ${data.url}:`, (err as Error).message);
    }
  }
  return out;
}

/**
 * Phase 2 — the teardown (+ optional script). Drives the status machine
 * analyzing → analyzed → (scripting → scripted), and stamps 'error' on any
 * failure so the live board never leaves a reel stuck mid-flight. Safe to run in
 * the background via after(); the watchlist sweep awaits it inline.
 */
export async function runAnalysis(
  reelId: number,
  data: ReelData,
  input: AnalyzeInput & { existingTeardown?: string },
): Promise<ReelRow | null> {
  try {
    let reel: ReelRow | null = null;
    // Reuse a prior teardown when one exists (e.g. "Generate script" on an
    // already-analyzed reel) — skip the reel-analyst entirely so we don't
    // re-spend a full sub-agent run just to feed the scriptwriter.
    let teardown = input.existingTeardown?.trim() ?? '';

    if (!teardown) {
      await updateReel(reelId, { status: 'analyzing' });

      // Analysis text (caption-first; Deepgram gated by policy).
      const spokenText = await resolveSpokenText(data);
      const hadSpokenText = spokenText.length > 0;
      const task = buildAnalystTask(data, spokenText, input.competitorId);

      // reel-analyst teardown. Ensure its agent_defs row exists first so its PULSE
      // persists between runs (setAgentPulse UPDATEs that row).
      await ensureBundledAgentRow('reel-analyst');
      // Cheap by default: TOOL-FREE single Haiku turn (no web_search loop). "Deep
      // analyze" upgrades to Sonnet + the full toolset for live-trend research.
      const analyst = await spawnSubAgent(
        'reel-analyst', task, undefined,
        input.deep ? { model: 'claude-sonnet-4-6', tools: 'all' } : { tools: 'none' },
      );
      if (!analyst.ok || !analyst.text) {
        await updateReel(reelId, { status: 'error' });
        throw new Error(`reel-analyst failed: ${analyst.error ?? 'no text returned'}`);
      }
      teardown = analyst.text;
      // Pull the "## Tags" the analyst emitted (REEL_TAG slugs only, capped at 4)
      // out of the fresh teardown so they're stored alongside it.
      const tags = parseReelTags(teardown);
      // Move to 'scripting' (not 'analyzed') when a script is queued, so the board
      // shows the hyperframes stage live; the teardown is already saved here.
      reel = (await updateReel(reelId, {
        status: input.withScript ? 'scripting' : 'analyzed',
        analysis: { teardown, hadSpokenText, tags, handle: data.handle ?? null },
      }));
    } else if (input.withScript) {
      // Already analyzed; just (re)write the script from the stored teardown.
      reel = (await updateReel(reelId, { status: 'scripting' }));
    } else {
      // Nothing to do — already analyzed and no script requested.
      return await getReel(reelId);
    }

    if (input.withScript) {
      const scriptRes = await spawnSubAgent(
        'hyperframes-agent',
        `<adapt this winning reel into a 9:16 KeyPlayers script>\n\n${teardown}`,
      );
      if (scriptRes.ok && scriptRes.text) {
        const draft = await createDraft({
          type: 'content_post',
          title: `Reel script — ${input.url}`.slice(0, 120),
          payload: scriptRes.text,
          createdBy: 'hyperframes-agent',
          metadata: { platform: 'instagram', format: 'reel', source: 'reel-intel', reel_id: reelId },
        });
        reel = (await updateReel(reelId, { status: 'scripted', script_draft_id: draft.id })) ?? reel;
      } else {
        // Script failed but the teardown stands — settle at 'analyzed', not 'error'.
        reel = (await updateReel(reelId, { status: 'analyzed' })) ?? reel;
      }
    }
    return reel;
  } catch (err) {
    await updateReel(reelId, { status: 'error' }).catch(() => {});
    throw err;
  }
}

/**
 * Drive one reel end-to-end (scrape → teardown → optional script). Synchronous
 * convenience used by the watchlist sweep; an API route that wants the live
 * board calls scrapeAndStore() then runAnalysis() in the background instead.
 * Throws on a hard failure; the sweep wraps each call in try/catch.
 */
export async function analyzeReel(input: AnalyzeInput): Promise<ReelRow> {
  const { reel, data } = await scrapeAndStore(input);
  const finished = await runAnalysis(reel.id, data, input);
  return finished ?? reel;
}

// Engagement score for ranking new reels: prefer views, fall back to likes +
// comments. null metrics count as 0 for ranking only (not stored as 0).
function engagementScore(r: Pick<ReelRow, 'views' | 'likes' | 'comments'>): number {
  if (r.views != null) return r.views;
  return (r.likes ?? 0) + (r.comments ?? 0);
}

const MAX_ANALYZE_PER_COMPETITOR = 2;
const PROFILE_FETCH_LIMIT = 8;

/**
 * Sweep every due competitor: fetch recent reels, store them, and analyze the
 * top-by-engagement NEW reel(s) (bounded to ~2 per competitor per run). Defensive
 * throughout — a single competitor or reel failure is logged and skipped so the
 * whole sweep never aborts. Stamps last_checked_at per competitor when handled.
 */
export async function runWatchlistDue(): Promise<{ checked: number; analyzed: number }> {
  let due: Competitor[];
  try {
    due = await dueCompetitors();
  } catch (err) {
    console.error('[reel-intel] dueCompetitors failed:', (err as Error).message);
    return { checked: 0, analyzed: 0 };
  }

  let checked = 0;
  let analyzed = 0;

  for (const competitor of due) {
    try {
      let scraped: ReelData[] = [];
      try {
        scraped = await scrapeProfileReels(competitor.handle, PROFILE_FETCH_LIMIT);
      } catch (err) {
        console.error(`[reel-intel] scrape failed for ${competitor.handle}:`, (err as Error).message);
      }

      // Store every fetched reel (status 'fetched'). A new row is one we hadn't
      // already analyzed/scripted — fresh inserts and re-fetched-but-unworked
      // reels both come back with status 'fetched', so they're eligible.
      const stored: ReelRow[] = [];
      for (const data of scraped) {
        if (!data.url) continue;
        try {
          const row = await upsertReel(reelDataToUpsert(data, competitor.id, 'fetched'));
          stored.push(row);
        } catch (err) {
          console.error(`[reel-intel] upsert failed for ${data.url}:`, (err as Error).message);
        }
      }

      // Pick the top-by-engagement NEW reels (still at 'fetched'), bounded.
      const ranked = stored
        .filter((r) => r.status === 'fetched')
        .map((r) => ({ row: r, score: engagementScore(r) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_ANALYZE_PER_COMPETITOR);

      for (const { row } of ranked) {
        try {
          await analyzeReel({ url: row.url, competitorId: competitor.id });
          analyzed++;
        } catch (err) {
          console.error(`[reel-intel] analyze failed for ${row.url}:`, (err as Error).message);
        }
      }

      // Stamp checked even if scrape/analysis partially failed — we did look.
      await markChecked(competitor.id).catch((err) =>
        console.error(`[reel-intel] markChecked failed for ${competitor.id}:`, (err as Error).message),
      );
      checked++;
    } catch (err) {
      console.error(`[reel-intel] competitor ${competitor.id} sweep failed:`, (err as Error).message);
    }
  }

  return { checked, analyzed };
}
