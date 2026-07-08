import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAccountInsights, isConnected } from '@/lib/instagram';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/instagram/insights — last 30-day account-level insights
// (reach, views, follower change). Powers the Instagram panel on /analytics.
// Returns { connected, insights } where insights is null when the account is
// connected but not Business/Creator (no API access).
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false });
  try {
    const insights = await getAccountInsights();
    return NextResponse.json({ connected: true, insights });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message }, { status: 502 });
  }
}
