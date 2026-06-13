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
  // Accept both 'running' and 'paused' — a paused mission was held by a budget
  // cap and may be resumed once the tenant is back under budget or the cap is raised.
  if (detail.mission.status !== 'running' && detail.mission.status !== 'paused') {
    return NextResponse.json({ error: `Mission is ${detail.mission.status}, not running` }, { status: 409 });
  }
  // If paused, first set back to 'running' so runAndChain can re-enter it.
  // runAndChain will re-check the budget gate and either proceed or re-pause.
  if (detail.mission.status === 'paused') {
    const { sql, tenantId } = await import('@/lib/db/client');
    await sql()`
      UPDATE public.wave_runs SET status = 'running', error = NULL, updated_at = now()
      WHERE tenant_id = ${tenantId()} AND id = ${id}
    `;
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
