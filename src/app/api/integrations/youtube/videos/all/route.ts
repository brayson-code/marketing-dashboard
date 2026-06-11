import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listAllVideos, isConnected } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // 5k videos = ~10 API calls, well under 60s

// GET /api/integrations/youtube/videos/all?max_pages=20
// Every video on the connected channel, newest first. Each page = 50 videos.
// Powers the /content/library gallery for YouTube.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, videos: [] });
  const maxPages = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('max_pages') ?? '20')));
  try {
    const videos = await listAllVideos({ maxPages });
    return NextResponse.json({ connected: true, count: videos.length, videos });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, videos: [] }, { status: 502 });
  }
}
