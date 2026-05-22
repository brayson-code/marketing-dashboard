import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { runNextWave, getCampaignDetail } from '@/lib/waves';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // one wave (2-3 agents) runs in the background

// POST /api/campaigns/:id/advance — run the next pending wave in the background.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getCampaignDetail(id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (detail.campaign.status !== 'running') {
    return NextResponse.json({ error: `Campaign is ${detail.campaign.status}, not running` }, { status: 409 });
  }
  after(async () => {
    try {
      await runNextWave(id);
    } catch (err) {
      console.error(`[campaigns] advance ${id} failed:`, (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: id }, { status: 202 });
}
