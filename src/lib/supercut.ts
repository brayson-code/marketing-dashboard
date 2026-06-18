// Supercut planner (server-side, no React, no ffmpeg).
//
// Takes a sentence and greedily plans which movie/TV clips cover which word-runs.
// PLANNING ONLY: it produces a list of segments with source clip URLs + trim
// timings. The client (a separate component) fetches each clip cross-origin and
// runs ffmpeg.wasm to trim/normalize/concat — there is NO server-side video work.
//
// Matching contract: PlayPhrase's `clip.words` is `unknown` raw payload; entries
// look like `{ text|word, start, end }` with start/end in MILLISECONDS. We parse
// defensively into a normalized internal word model and scan for contiguous runs.

import { searchMovieClips, type MovieClip } from '@/lib/playphrase';

export interface SupercutSegment {
  text: string; // the matched run, normalized-joined display form (original-cased run words joined by ' ')
  videoUrl: string; // the source clip's open-S3 mp4 (CORS-fetchable client-side)
  startMs: number; // trim start inside that clip (= firstWord.start)
  endMs: number; // trim end inside that clip   (= lastWord.end)
  movie: string; // clip.movie, for the UI segment list / attribution
}

export interface SupercutPlan {
  segments: SupercutSegment[];
  skipped: string[]; // individual source words (original-cased) that could not be located in ANY clip
}

// ── Word model + normalization ───────────────────────────────────────────────
interface ClipWord {
  norm: string;
  start: number;
  end: number;
}

// Normalize a token for matching. Used for BOTH the sentence tokens and clip
// words so they compare apples-to-apples. May return '' (pure punctuation).
export function normWord(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']/g, '');
}

// Defensive parse of PlayPhrase's raw `words` into a normalized word array,
// preserving spoken order.
function parseClipWords(words: unknown): ClipWord[] {
  if (!Array.isArray(words)) return [];
  const out: ClipWord[] = [];
  for (const entry of words) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as Record<string, unknown>;
    const raw = (e.text ?? e.word) as unknown;
    if (typeof raw !== 'string') continue;
    const start = Number(e.start);
    const end = Number(e.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const norm = normWord(raw);
    if (norm === '') continue;
    out.push({ norm, start, end });
  }
  return out;
}

// Find the [startMs, endMs] of the first contiguous occurrence of `runTokens`
// (already normalized, length >= 1) inside the clip's word array, or null.
function locateRun(
  clipWords: ClipWord[],
  runTokens: string[],
): { startMs: number; endMs: number } | null {
  if (clipWords.length < runTokens.length) return null;
  for (let i = 0; i <= clipWords.length - runTokens.length; i++) {
    let matched = true;
    for (let j = 0; j < runTokens.length; j++) {
      if (clipWords[i + j].norm !== runTokens[j]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    const startMs = clipWords[i].start;
    const endMs = clipWords[i + runTokens.length - 1].end;
    // Corrupt timing → treat as no match so the caller can fall back to a shorter run.
    if (endMs <= startMs) continue;
    return { startMs, endMs };
  }
  return null;
}

const MAX_RUN_WORDS = 6; // cap on run length per facts
const SEARCH_LIMIT = 6; // clips to pull per phrase search (>1 so a run that
// isn't locatable in the top clip can still be found
// in another result for the same phrase)

export async function planSupercut(sentence: string): Promise<SupercutPlan> {
  // 1. Tokenize: split on whitespace, normalize, drop empty-norm tokens.
  const rawTokens: string[] = [];
  const normTokens: string[] = [];
  const trimmed = sentence.trim();
  if (trimmed) {
    for (const raw of trimmed.split(/\s+/)) {
      const norm = normWord(raw);
      if (norm === '') continue;
      rawTokens.push(raw);
      normTokens.push(norm);
    }
  }

  const segments: SupercutSegment[] = [];
  const skipped: string[] = [];

  // De-dup identical phrase searches within one plan.
  const searchCache = new Map<string, MovieClip[]>();
  async function search(phrase: string): Promise<MovieClip[]> {
    const cached = searchCache.get(phrase);
    if (cached) return cached;
    try {
      const { clips } = await searchMovieClips(phrase, { limit: SEARCH_LIMIT });
      searchCache.set(phrase, clips);
      return clips;
    } catch {
      // Treat a thrown search (browser hiccup) as no clips for this run length.
      searchCache.set(phrase, []);
      return [];
    }
  }

  // 2. Greedy walk: longest-match first, backing off to shorter runs.
  let i = 0;
  while (i < normTokens.length) {
    let placed = false;
    const maxLen = Math.min(MAX_RUN_WORDS, normTokens.length - i);
    for (let len = maxLen; len >= 1; len--) {
      const runNorm = normTokens.slice(i, i + len);
      const phrase = runNorm.join(' ');
      const clips = await search(phrase);
      for (const clip of clips) {
        const cw = parseClipWords(clip.words);
        const loc = locateRun(cw, runNorm);
        if (loc !== null) {
          segments.push({
            text: rawTokens.slice(i, i + len).join(' '),
            videoUrl: clip.videoUrl,
            startMs: loc.startMs,
            endMs: loc.endMs,
            movie: clip.movie,
          });
          i += len;
          placed = true;
          break;
        }
      }
      if (placed) break;
    }
    if (!placed) {
      skipped.push(rawTokens[i]);
      i += 1;
    }
  }

  return { segments, skipped };
}
