import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listRecentVideos, isConnected } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/youtube/videos?max=10 — recent uploads with per-video stats.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, videos: [] });
  const max = Math.min(50, Math.max(1, Number(new URL(request.url).searchParams.get('max') ?? '10')));
  try {
    return NextResponse.json({ connected: true, videos: await listRecentVideos(max) });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, videos: [] }, { status: 502 });
  }
}
