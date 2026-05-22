import { NextResponse } from 'next/server';
import { getPolicy, recentRewardEvents } from '@/lib/reward';

export const dynamic = 'force-dynamic';

// GET /api/learning — the reward policy + recent scored runs (measurement loop).
export async function GET() {
  try {
    const [policy, events] = await Promise.all([getPolicy(), recentRewardEvents(60)]);
    const totalRuns = policy.reduce((s, p) => s + p.n, 0);
    const weightedMean = totalRuns > 0 ? policy.reduce((s, p) => s + p.reward_mean * p.n, 0) / totalRuns : 0;
    const byRole: Record<string, { n: number; mean: number }> = {};
    for (const p of policy) {
      const r = (byRole[p.role] ??= { n: 0, mean: 0 });
      r.mean = (r.mean * r.n + p.reward_mean * p.n) / (r.n + p.n || 1);
      r.n += p.n;
    }
    return NextResponse.json({ policy, events, summary: { totalRuns, weightedMean, byRole } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
