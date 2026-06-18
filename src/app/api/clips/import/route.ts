// Import a chosen PlayPhrase clip into the tenant's media library.
// POST { videoUrl, text?, movie? } → { asset }. Flag- and tenant-gated.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { importMovieClip } from '@/lib/playphrase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (process.env.MOVIE_CLIPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'disabled' }, { status: 503 });
  }
  try {
    enterTenant(await resolveTenant());
  } catch {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: { videoUrl?: string; text?: string; movie?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  if (!body?.videoUrl) {
    return NextResponse.json({ error: 'videoUrl required' }, { status: 400 });
  }

  try {
    const asset = await importMovieClip({ videoUrl: body.videoUrl, text: body.text, movie: body.movie });
    return NextResponse.json({ asset });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'import failed' },
      { status: 502 },
    );
  }
}
