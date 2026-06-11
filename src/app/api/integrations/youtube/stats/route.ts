import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getChannelStats, last30DayMetrics, isConnected } from '@/lib/youtube';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/youtube/stats
// Channel headline (subs/views/videos) + last 30-day metrics (views, watch
// time, subs gained). Used by /analytics for the YouTube panel and by the
// AI CMO weekly cron to inject real numbers into its brief review.
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
  try {
    const [channel, metrics] = await Promise.all([getChannelStats(), last30DayMetrics()]);
    return NextResponse.json({ connected: true, channel, metrics });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message }, { status: 502 });
  }
}
