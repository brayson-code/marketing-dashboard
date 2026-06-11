import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { listMissions, getMissionDetail } from '@/lib/waves';
import { loadGoals } from '@/lib/goals';

// Pipeline visualization data source. Reuses the wave_runs accessors in
// @/lib/waves (which already scope every query to tenantId()).
//   GET /api/pipeline            -> { missions }
//   GET /api/pipeline?id=<uuid>  -> { detail: { mission, steps } } | 404 { error }
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (id) {
      const detail = await getMissionDetail(id);
      if (!detail) {
        return NextResponse.json({ error: 'Mission not found' }, { status: 404 });
      }
      // Resolve the goal's human title for the terminal node (falls back to the id).
      const goalId = detail.mission.goal_id as string | null;
      if (goalId) {
        const goal = (await loadGoals().catch(() => [])).find((g) => g.id === goalId);
        if (goal) detail.mission.goal_title = goal.title;
      }
      return NextResponse.json({ detail });
    }
    return NextResponse.json({ missions: await listMissions() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
