// Movie-clip search (PlayPhrase). POST { phrase } → { clips, cached }.
// Feature-flagged (MOVIE_CLIPS_ENABLED) for a clean kill switch; tenant-gated so
// only an authenticated workspace can drive the (cost-bearing) browser search.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { searchMovieClips } from '@/lib/playphrase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a cold instance must boot Chromium

// Per-tenant sliding-window rate limit. In-memory (resets on instance restart) —
// fine for V1, same approach as the sub-agent limiter. Stops a single workspace
// from hammering unique phrases (which would burn browser launches + risk getting
// our egress IP throttled by PlayPhrase). Cached searches are cheap but still
// counted so the endpoint itself can't be abused.
const RL_WINDOW_MS = 60_000;
const RL_MAX = 20;
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
  if (process.env.MOVIE_CLIPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled', clips: [] }, { status: 503 });
  }
  try {
    enterTenant(await resolveTenant());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  if (rateLimited(tenantId())) {
    return NextResponse.json(
      { error: 'Too many searches — give it a moment and try again.', clips: [] },
      { status: 429 },
    );
  }

  let phrase = '';
  let count = 8;
  try {
    const body = await req.json();
    phrase = String(body?.phrase ?? '').slice(0, 120);
    if (Number.isFinite(body?.count)) count = Math.min(Math.max(Number(body.count), 1), 12);
  } catch {
    /* empty body */
  }
  if (!phrase.trim()) {
    return NextResponse.json({ error: 'phrase required', clips: [] }, { status: 400 });
  }

  try {
    const { clips, cached } = await searchMovieClips(phrase, { limit: count });
    return NextResponse.json({ clips, cached }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'search failed', clips: [] },
      { status: 502 },
    );
  }
}
