import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAdAccount, get30DayStats, getTopCampaigns, isConnected } from '@/lib/facebook-ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/facebook-ads/stats
// Last-30-day Marketing API insights for the tenant's first active ad account
// (spend / CTR / CPM / frequency / hold rate / ROAS), plus a small
// top-campaigns-by-spend breakdown and the account currency for agent
// consumers (the panel ignores the extras). Not connected → 200 { connected:false }.
//
// Errors come back as 200: the panel discards non-2xx bodies (res.ok gate),
// and it only renders the error branch when `stats` is truthy — so we ship an
// empty stats object alongside the message instead of a 502.
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) {
    return NextResponse.json({ connected: false }, { status: 200 });
  }
  try {
    const account = await getAdAccount();
    if (!account) {
      return NextResponse.json(
        { connected: true, stats: {}, error: 'Facebook Ads: no ad account is visible to this connection.' },
        { status: 200 },
      );
    }
    const [stats, campaigns] = await Promise.all([
      get30DayStats(account),
      getTopCampaigns(account).catch(() => []), // breakdown is decorative — never sink the panel
    ]);
    return NextResponse.json({ connected: true, stats, campaigns, currency: account.currency });
  } catch (e) {
    const msg = (e as Error).message.replace(/^facebook-ads:\s*/, '');
    return NextResponse.json({ connected: true, stats: {}, error: `Facebook Ads: ${msg}` }, { status: 200 });
  }
}
