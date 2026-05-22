import { NextResponse, after } from 'next/server';
import { listCampaigns, runNextWave } from '@/lib/waves';
import { launchResearchCampaign } from '@/lib/campaign-intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // kickoff runs wave 1 in the background via after()

// GET /api/campaigns — list campaigns (newest first).
export async function GET() {
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/campaigns — { request } → intake brief + goal + 4-wave campaign;
// wave 1 starts immediately in the background. Owner advances later waves.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const req = typeof body?.request === 'string' ? body.request : '';
  try {
    const launched = await launchResearchCampaign(req);
    after(async () => {
      try {
        await runNextWave(launched.id);
      } catch (err) {
        console.error(`[campaigns] wave 1 of ${launched.id} failed:`, (err as Error).message);
      }
    });
    return NextResponse.json({ ...launched, dispatched: 'wave-1' }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
