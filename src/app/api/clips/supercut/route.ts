// Supercut planner (PlayPhrase). POST { sentence } → { segments, skipped }.
// Plan ONLY: maps a sentence to a list of movie/TV clip segments with trim timing;
// the client does all video work (ffmpeg.wasm) — NO server-side video processing.
// Feature-flagged (SUPERCUT_ENABLED) for an independent kill switch separate from
// MOVIE_CLIPS_ENABLED; tenant-gated so only an authenticated workspace can drive
// the (cost-bearing) planner fan-out into headless Chromium searches.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { planSupercut } from '@/lib/supercut';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a cold instance must boot Chromium for fresh phrases

// Per-tenant sliding-window rate limit. In-memory (resets on instance restart) —
// same approach as the clip-search limiter, but with a LOWER cap because each
// supercut call fans out to many internal phrase searches (greedy backoff).
const RL_WINDOW_MS = 60_000;
const RL_MAX = 5; // 5 supercut plans / min / tenant
const hits = new Map<string, number[]>();
function rateLimited(key: string): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < RL_WINDOW_MS);
  if (recent.length >= RL_MAX) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  return false;
}

export async function POST(req: NextRequest) {
  if (process.env.SUPERCUT_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled', segments: [], skipped: [] }, { status: 503 });
  }
  try {
    enterTenant(await resolveTenant());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (rateLimited(tenantId())) {
    return NextResponse.json(
      { error: 'Too many supercuts — give it a moment and try again.', segments: [], skipped: [] },
      { status: 429 },
    );
  }

  // ── input safety ──
  let sentence = '';
  try {
    const body = await req.json();
    if (typeof body?.sentence !== 'string') {
      return NextResponse.json({ error: 'sentence required', segments: [], skipped: [] }, { status: 400 });
    }
    sentence = body.sentence.replace(/\s+/g, ' ').trim().slice(0, 280); // hard char cap
  } catch {
    return NextResponse.json({ error: 'invalid body', segments: [], skipped: [] }, { status: 400 });
  }
  if (!sentence) {
    return NextResponse.json({ error: 'sentence required', segments: [], skipped: [] }, { status: 400 });
  }
  // word cap: bound the planner fan-out
  const words = sentence.split(' ').filter(Boolean);
  if (words.length > 40) {
    return NextResponse.json(
      { error: 'Keep it under 40 words for now.', segments: [], skipped: [] },
      { status: 400 },
    );
  }

  try {
    const { segments, skipped } = await planSupercut(sentence);
    return NextResponse.json({ segments, skipped }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'supercut planning failed', segments: [], skipped: [] },
      { status: 502 },
    );
  }
}
