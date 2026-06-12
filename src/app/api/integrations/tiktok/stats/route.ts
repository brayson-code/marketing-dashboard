import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getOverview, isConnected } from '@/lib/tiktok';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/tiktok/stats
// Account headline (followers / views / engagement, last 30d) + recent videos
// in one payload — the analytics TikTok panel reads r.stats and r.videos from
// this single call. Not connected → 200 { connected:false }.
//
// Errors come back as 200 too: the panel discards non-2xx bodies (res.ok
// gate), and it only renders the error branch when `stats` is truthy — so we
// ship an empty stats object alongside the message instead of a 502.
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
  try {
    const { stats, videos } = await getOverview();
    return NextResponse.json({ connected: true, stats, videos });
  } catch (e) {
    const msg = (e as Error).message.replace(/^tiktok:\s*/, '');
    return NextResponse.json({ connected: true, stats: {}, error: `TikTok: ${msg}` }, { status: 200 });
  }
}
