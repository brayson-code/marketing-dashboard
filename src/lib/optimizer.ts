// Reel optimizer pipeline — the orchestration glue for Content Lab's "Optimize my
// reel" flow. Unlike reel-intel.ts (which tears down COMPETITOR reels for
// inspiration), this scans the tenant's OWN reel against a chosen goal and returns
// a structured, goal-tailored optimization report.
//
// runScan() drives a single scan end-to-end: scrape the reel (Apify) → resolve a
// transcript (subtitles first, Deepgram only when explicitly enabled) → pull the
// reel's REAL IG insights when the account is connected (best-effort) → hand it all
// to the reel-optimizer sub-agent → parse its JSON defensively → persist scores +
// report. Any failure stamps status 'error'; it NEVER rethrows past this function
// because it runs in after() (an unhandled rejection there would crash the worker).
//
// TRANSCRIPTION POLICY mirrors reel-intel: caption + subtitles first. Deepgram only
// runs when REEL_TRANSCRIBE === 'on' AND the reel has no subtitles AND a video URL
// exists AND a Deepgram key is configured. Any Deepgram miss degrades to ''.

import { scrapeReel, type ReelData } from './apify';
import { transcribeUrl, getDeepgramKey } from './deepgram';
import { getMediaInsights } from './instagram';
import { spawnSubAgent } from './subagent';
import { ensureBundledAgentRow } from './agent-defs';
import {
  getScan,
  updateScan,
  type ScanScores,
  type ScanReport,
  type ScanWeakPoint,
  type ScanRewrite,
} from './reel-scans';

// The five scoring dimensions, in canonical order. Used to validate + clamp the
// agent's `scores` object so a malformed/partial object never lands in the DB.
const SCORE_KEYS: (keyof ScanScores)[] = [
  'voiceImpact',
  'visualPull',
  'cognitiveGrip',
  'emotionalHit',
  'memorability',
];

// Resolve the spoken text for the scan. Caption-first: prefer scraped subtitles;
// only fall back to Deepgram when the env flag is on, there's no subtitles, a video
// URL exists, and a key is configured. Any failure degrades gracefully to ''.
async function resolveTranscript(data: ReelData): Promise<string> {
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
    console.error('[optimizer] deepgram transcribe failed:', (err as Error).message);
    return '';
  }
}

// Human-readable label for a goal, used to frame the optimizer's brief.
const GOAL_LABELS: Record<string, string> = {
  views: 'maximize VIEWS / reach (hook strength, shareability, watch-through)',
  retention: 'maximize RETENTION (hold attention to the end, pacing, loops)',
  sales: 'drive SALES / conversions (offer clarity, CTA, desire)',
  engagement: 'drive ENGAGEMENT (comments, saves, shares, replies)',
  general: 'general overall performance across hook, retention, and payoff',
};

// Compose the reel-optimizer brief: goal + caption + scraped metrics + (real IG
// insights when present) + transcript. The agent returns the structured JSON the
// report is parsed from.
function buildOptimizerTask(
  goal: string,
  data: ReelData,
  insights: Awaited<ReturnType<typeof getMediaInsights>>,
  transcript: string,
): string {
  const goalLabel = GOAL_LABELS[goal] ?? GOAL_LABELS.general;
  const metric = (label: string, v: number | null | undefined) =>
    `${label}: ${v != null ? v.toLocaleString() : 'unknown'}`;

  const lines: (string | null)[] = [
    'Optimize this short-form reel. Reverse-engineer what is working and what is holding it back, then return a structured, prioritized optimization report.',
    '',
    `# Goal`,
    `The owner wants to ${goalLabel}. Tailor EVERY weak point and rewrite to this goal.`,
    '',
    `# Reel`,
    `URL: ${data.url}`,
    [metric('Views', data.views), metric('Likes', data.likes), metric('Comments', data.comments)].join('  ·  '),
  ];

  if (insights) {
    // Real first-party IG insights (only present when the reel is on the connected
    // account). These are far more accurate than scraped metrics — say so.
    const realLines = [
      metric('Reach', insights.reach),
      metric('Plays', insights.plays),
      metric('Saves', insights.saves),
      metric('Shares', insights.shares),
      metric('Total interactions', insights.totalInteractions),
      insights.avgWatchSec != null ? `Avg watch: ${insights.avgWatchSec}s` : null,
    ].filter((l): l is string => l !== null);
    if (realLines.length > 0) {
      lines.push('', '# Real Instagram insights (first-party — trust these over scraped numbers)', realLines.join('  ·  '));
    }
  }

  lines.push(
    '',
    '# Caption',
    data.caption?.trim() || '(no caption)',
    '',
    '# Transcript (spoken text / subtitles)',
    transcript || 'no transcript available — analyze from caption + metrics only.',
  );

  return lines.filter((l): l is string => l !== null).join('\n');
}

// ── Defensive JSON parsing ───────────────────────────────────────────────────
// The optimizer returns a JSON object, but model output can carry code fences or
// prose around it. Strip fences, then find the FIRST balanced {...} block and
// JSON.parse it. Returns null when nothing parses (caller stamps 'error').
function extractJsonObject(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Strip a leading ```json / ``` fence and any trailing fence.
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  // Find the first '{' and walk to its matching '}', respecting strings/escapes so
  // a brace inside a string value doesn't end the block early.
  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const block = s.slice(start, i + 1);
        try {
          const parsed = JSON.parse(block);
          return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Clamp a value into a 0-100 integer score; non-numeric → 0.
function clampScore(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Validate + clamp the scores object: every one of the 5 keys, each a 0-100 number.
// Returns null when `raw` isn't an object (so the report can still save without
// scores rather than fabricating zeros for a totally missing block).
function parseScores(raw: unknown): ScanScores | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const out = {} as ScanScores;
  for (const key of SCORE_KEYS) out[key] = clampScore(obj[key]);
  return out;
}

// Coerce an arbitrary value to a string[] (drops empties; trims). Default [].
function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === 'string' ? v.trim() : String(v ?? '').trim()))
    .filter((s) => s.length > 0);
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim();
}

function parseWeakPoints(raw: unknown): ScanWeakPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
    .map((x) => ({
      timestamp: x.timestamp != null ? str(x.timestamp) || null : null,
      issue: str(x.issue),
      fix: str(x.fix),
    }))
    .filter((w) => w.issue || w.fix);
}

function parseRewrites(raw: unknown): ScanRewrite[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is Record<string, unknown> => x != null && typeof x === 'object')
    .map((x) => ({
      category: str(x.category),
      currently: str(x.currently),
      suggestion: str(x.suggestion),
      expectedImpact: str(x.expectedImpact),
    }))
    .filter((r) => r.suggestion || r.currently);
}

// Build the persisted ScanReport from the parsed object. Arrays default to [].
function parseReport(obj: Record<string, unknown>): ScanReport {
  return {
    summary: str(obj.summary),
    verdict: str(obj.verdict),
    strengths: toStringArray(obj.strengths),
    weakPoints: parseWeakPoints(obj.weakPoints),
    rewrites: parseRewrites(obj.rewrites),
  };
}

/**
 * Run one reel scan end-to-end. Scrapes the reel, resolves a transcript, pulls
 * real IG insights (best-effort), spawns the reel-optimizer, parses its JSON, and
 * persists scores + report (status 'done'). On any failure it stamps status
 * 'error' with the message. NEVER rethrows — it runs in after().
 */
export async function runScan(scanId: number): Promise<void> {
  const scan = await getScan(scanId);
  if (!scan) return;

  try {
    // 1) Scrape the reel → thumbnail + caption/metrics/subtitles/videoUrl.
    const data = await scrapeReel(scan.url);
    const thumbnailUrl = data.thumbnailUrl ?? null;

    // 2) Transcript (caption-first; Deepgram gated by REEL_TRANSCRIBE policy).
    const transcript = await resolveTranscript(data);
    const hadTranscript = transcript.length > 0;

    // 3) Real first-party IG insights — null when no connection / not found / any
    //    error (getMediaInsights is best-effort and never throws).
    const insights = await getMediaInsights(scan.url);

    // 4) Tool-free single optimizer turn over everything we gathered.
    const task = buildOptimizerTask(scan.goal, data, insights, transcript);
    await ensureBundledAgentRow('reel-optimizer');
    const result = await spawnSubAgent('reel-optimizer', task, undefined, { tools: 'none' });
    if (!result.ok || !result.text) {
      throw new Error(`reel-optimizer failed: ${result.error ?? 'no text returned'}`);
    }

    // 5) Parse the JSON defensively. A malformed block is a hard failure (we'd
    //    rather show 'error' than persist an empty report as success).
    const obj = extractJsonObject(result.text);
    if (!obj) throw new Error('reel-optimizer returned no parseable JSON object');

    const scores = parseScores(obj.scores);
    const report = parseReport(obj);

    await updateScan(scanId, {
      status: 'done',
      had_transcript: hadTranscript,
      thumbnail_url: thumbnailUrl,
      scores,
      report,
    });
  } catch (err) {
    const message = (err as Error)?.message ?? 'scan failed';
    await updateScan(scanId, { status: 'error', error: message }).catch((e) =>
      console.error('[optimizer] failed to record scan error:', (e as Error).message),
    );
    // Deliberately do NOT rethrow: runScan runs inside after().
  }
}
