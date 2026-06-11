import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { latestHeartbeatsByAgent } from '@/lib/heartbeat';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/hero-agents?department=leadership
//
// Returns the agents that should appear on the Overview's hero row + queue
// avatars, filtered by the active lens tab.
//   - Leadership lens → the 5 C-suite executives (one per department).
//   - Any other lens  → that department's executive head + all team agents
//                       in that department.
//
// We compute a synthetic "status" + "focus" for each agent from agent_tasks in
// the last 7 days so the card pills aren't fake. Real status copy/progress can
// come from a richer model later — this is honest signal from existing data.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const dept = (new URL(request.url).searchParams.get('department') ?? 'leadership').toLowerCase();
    const validDept = ['leadership','marketing','revenue','operations','client_experience'].includes(dept) ? dept : 'leadership';

    // Leadership lens = the executive org chart (all C-suite + orchestrator).
    // Every other lens = just that department's team (head + sub-agents).
    const baseRows = validDept === 'leadership'
      ? await sql()`
          SELECT id, name, role_title, department, description, is_executive
          FROM public.agent_defs
          WHERE tenant_id = ${tenantId()}
            AND (is_executive = true OR department = 'leadership')
            AND enabled = true
          ORDER BY
            CASE id WHEN 'keyplayer' THEN 0 WHEN 'ai-ceo' THEN 1 ELSE 2 END,
            CASE department
              WHEN 'leadership' THEN 0 WHEN 'marketing' THEN 1
              WHEN 'revenue' THEN 2 WHEN 'operations' THEN 3
              WHEN 'client_experience' THEN 4 ELSE 5
            END
        `
      : await sql()`
          SELECT id, name, role_title, department, description, is_executive
          FROM public.agent_defs
          WHERE tenant_id = ${tenantId()} AND department = ${validDept} AND enabled = true
          ORDER BY is_executive DESC, name ASC
        `;

    const baseList = baseRows as unknown as Array<{
      id: string; name: string; role_title: string | null; department: string | null;
      description: string; is_executive: boolean;
    }>;
    const ids = baseList.map((r) => r.id);
    if (ids.length === 0) {
      return NextResponse.json({ department: validDept, agents: [] });
    }

    // Activity stats — last 7 days. agent_tasks.started_at is timestamptz, so
    // compare in timestamp space and extract epoch for the JSON last_active.
    const stats = (await sql()`
      SELECT agent_id,
             COUNT(*)::int                                          AS runs_7d,
             SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END)::int AS running,
             MAX(extract(epoch from started_at))::int               AS last_active
      FROM public.agent_tasks
      WHERE tenant_id = ${tenantId()}
        AND agent_id = ANY(${ids})
        AND started_at >= now() - interval '7 days'
      GROUP BY agent_id
    `) as unknown as Array<{ agent_id: string; runs_7d: number; running: number; last_active: number | null }>;

    const byId = new Map(stats.map((s) => [s.agent_id, s]));
    // Latest heartbeat per agent (last 24h). Powers the live "currently: X"
    // ticker on each hero card. Map is empty + lookups silent on failure.
    const beats = await latestHeartbeatsByAgent();

    // Owned goals — each goal can claim one agent via metadata.owner_agent.
    // The hero card uses this to show the goal title under the progress bar
    // and to compute the bar's real value (status weights, same as /goals).
    const goalRows = (await sql()`
      SELECT id, title, status, due,
             metadata->>'owner_agent' AS owner_agent,
             COALESCE((metadata->>'is_north_star')::bool, false) AS is_north_star
      FROM public.goals
      WHERE tenant_id = ${tenantId()}
        AND metadata->>'owner_agent' = ANY(${ids})
        AND status != 'abandoned'
    `) as unknown as Array<{ id: string; title: string; status: string; due: string | null; owner_agent: string; is_north_star: boolean }>;
    // Pick one goal per agent: prefer north-star, then active over pending, deterministic.
    const STATUS_WEIGHT: Record<string, number> = { done: 1, pending_verification: 0.85, active: 0.3 };
    const goalByAgent = new Map<string, { id: string; title: string; status: string; due: string | null; progress: number; is_north_star: boolean }>();
    for (const g of goalRows) {
      const existing = goalByAgent.get(g.owner_agent);
      if (!existing || (g.is_north_star && !existing.is_north_star)) {
        const progress = Math.round((STATUS_WEIGHT[g.status] ?? 0.3) * 100);
        goalByAgent.set(g.owner_agent, {
          id: g.id, title: g.title, status: g.status, due: g.due, progress, is_north_star: g.is_north_star,
        });
      }
    }

    const agents = baseList.map((a) => {
      const s = byId.get(a.id);
      const running = (s?.running ?? 0) > 0;
      const recent = (s?.runs_7d ?? 0) > 0;
      const beat = beats.get(a.id) ?? null;
      const goal = goalByAgent.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        role_title: a.role_title ?? a.name,
        department: a.department,
        description: a.description,
        is_executive: a.is_executive,
        status: running ? 'active' : recent ? 'reviewing' : 'idle',
        runs_7d: s?.runs_7d ?? 0,
        last_active: s?.last_active ?? null,
        heartbeat: beat ? { ts: beat.ts, kind: beat.kind, message: beat.message } : null,
        goal,
      };
    });

    return NextResponse.json({ department: validDept, agents });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
