import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { runAndChain, getMissionDetail } from '@/lib/waves';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // one wave (2-3 agents) runs in the background

// POST /api/missions/:id/advance — run the next pending wave in the background.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const detail = await getMissionDetail(id);
  if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (detail.mission.status !== 'running') {
    return NextResponse.json({ error: `Mission is ${detail.mission.status}, not running` }, { status: 409 });
  }
  after(async () => {
    try {
      await runAndChain(id); // resume + auto-advance to completion
    } catch (err) {
      console.error(`[missions] advance ${id} failed:`, (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: id }, { status: 202 });
}
