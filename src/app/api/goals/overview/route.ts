import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/goals/overview
// Returns the North Star goal + the top 3 priority active goals for the
// Overview hero strip. We expose metadata.owner_agent / is_north_star / priority
// here so the UI can render them without re-fetching the raw goals + parsing.
//
// Status weighting matches /api/hero-agents and the KPI strip:
//   done = 1.0, pending_verification = 0.85, active = 0.3, abandoned excluded.
const STATUS_WEIGHT: Record<string, number> = { done: 1, pending_verification: 0.85, active: 0.3 };
const PRIORITY_RANK: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

interface OverviewGoal {
  id: string;
  title: string;
  status: string;
  due: string | null;
  success: string;
  evidence: string | null;
  owner_agent: string | null;
  priority: string;          // 'P0' | 'P1' | 'P2' | 'P3' (default 'P2')
  category: string | null;
  is_north_star: boolean;
  progress: number;          // 0-100
}

export async function GET() {
  enterTenant(await resolveTenant());
  try {
    interface Row {
      id: string; title: string; status: string; due: string | null;
      success: string; evidence: string | null;
      owner_agent: string | null; priority: string | null;
      category: string | null; is_north_star: boolean | null;
    }
    const rows = (await sql()`
      SELECT id, title, status,
             to_char(due, 'YYYY-MM-DD')          AS due,
             success, evidence,
             metadata->>'owner_agent'            AS owner_agent,
             metadata->>'priority'               AS priority,
             metadata->>'category'               AS category,
             (metadata->>'is_north_star')::bool  AS is_north_star
      FROM public.goals
      WHERE tenant_id = ${tenantId()}
        AND status != 'abandoned'
      ORDER BY updated_at DESC
    `) as unknown as Row[];

    const goals: OverviewGoal[] = rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      due: r.due,
      success: r.success,
      evidence: r.evidence,
      owner_agent: r.owner_agent,
      priority: r.priority ?? 'P2',
      category: r.category,
      is_north_star: !!r.is_north_star,
      progress: Math.round((STATUS_WEIGHT[r.status] ?? 0.3) * 100),
    }));

    // North Star is the explicitly-flagged goal; falls back to the highest-priority
    // active goal so the slot is never empty when goals exist.
    const flagged = goals.find((g) => g.is_north_star) ?? null;
    const fallback = goals
      .filter((g) => g.status === 'active')
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))[0] ?? null;
    const northStar = flagged ?? fallback;

    // Top 3 = next-highest priority active goals (excluding the north star).
    const priorities = goals
      .filter((g) => g.status === 'active' && g.id !== northStar?.id)
      .sort((a, b) => (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9))
      .slice(0, 3);

    return NextResponse.json({ north_star: northStar, priorities, all_count: goals.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, north_star: null, priorities: [], all_count: 0 }, { status: 500 });
  }
}
