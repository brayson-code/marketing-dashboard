// Movie-clip search (PlayPhrase). POST { phrase } → { clips, cached }.
// Feature-flagged (MOVIE_CLIPS_ENABLED) for a clean kill switch; tenant-gated so
// only an authenticated workspace can drive the (cost-bearing) browser search.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { searchMovieClips } from '@/lib/playphrase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // a cold instance must boot Chromium

export async function POST(req: NextRequest) {
  if (process.env.MOVIE_CLIPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled', clips: [] }, { status: 503 });
  }
  try {
    enterTenant(await resolveTenant());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let phrase = '';
  try {
    phrase = String((await req.json())?.phrase ?? '').slice(0, 120);
  } catch {
    /* empty body */
  }
  if (!phrase.trim()) {
    return NextResponse.json({ error: 'phrase required', clips: [] }, { status: 400 });
  }

  try {
    const { clips, cached } = await searchMovieClips(phrase, { limit: 12 });
    return NextResponse.json({ clips, cached }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'search failed', clips: [] },
      { status: 502 },
    );
  }
}
