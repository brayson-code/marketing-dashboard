import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { recentHeartbeats } from '@/lib/heartbeat';
import { isKnownBundledAgent } from '@/lib/agent-defs';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/agents/[id]/memory
// Returns this agent's "memory" — the recent work it has actually done.
// Today that's a chronological tail of its agent_tasks (most recent first).
// When per-agent rolled-up summaries (memory.md) land in the DB, those become
// the headline and these tasks become the supporting timeline below it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  try {
    const { id } = await params;

    type AgentDef = {
      id: string; name: string; role: string; role_title: string | null;
      department: string | null; description: string; model: string;
      pulse: string; pulse_updated_at: number; spawnable: boolean;
    };
    const rows = (await sql()`
      SELECT id, name, role, role_title, department, description, model, pulse, spawnable,
             extract(epoch from updated_at)::int AS pulse_updated_at
      FROM public.agent_defs
      WHERE tenant_id = ${tenantId()} AND id = ${id}
      LIMIT 1
    `) as unknown as AgentDef[];

    let def: AgentDef | undefined = rows[0];
    if (!def) {
      // Not seeded into THIS tenant's agent_defs (e.g. a sub-agent on a tenant
      // that only got the C-suite). The squad list shows bundled/fallback agents,
      // so the detail page must open them too — synthesize a minimal def from the
      // bundled roster instead of 404-ing. Memory/heartbeats below still resolve.
      const { squadRoster } = await import('@/lib/squad');
      const meta = squadRoster().find((a) => a.id === id);
      if (!meta) return NextResponse.json({ error: 'Agent not found' }, { status: 404 });
      def = {
        id: meta.id, name: meta.name, role: meta.role, role_title: null,
        department: meta.department ?? null, description: meta.description,
        model: meta.model, pulse: '', pulse_updated_at: 0, spawnable: true,
      };
    }

    // Editable iff prompt edits would actually take effect: a real bundled
    // specialist (spawns via subagent.ts DB-first), or a saved spawnable row
    // (e.g. the C-suite). The orchestrator / system agents load prompts
    // elsewhere, so we don't surface an Edit button that would no-op.
    const editable = (rows[0]?.spawnable ?? false) || (await isKnownBundledAgent(id));

    const tasks = (await sql()`
      SELECT id, status, task, result, error,
             input_tokens, output_tokens,
             extract(epoch from started_at)::int AS started_at_epoch,
             CASE WHEN completed_at IS NULL THEN NULL
                  ELSE extract(epoch from completed_at)::int END AS completed_at_epoch
      FROM public.agent_tasks
      WHERE tenant_id = ${tenantId()} AND agent_id = ${id}
      ORDER BY started_at DESC
      LIMIT 50
    `) as unknown as Array<{
      id: number; status: string; task: string; result: string | null; error: string | null;
      input_tokens: number | null; output_tokens: number | null;
      started_at_epoch: number; completed_at_epoch: number | null;
    }>;

    const totals = tasks.reduce(
      (acc, t) => ({
        runs: acc.runs + 1,
        done: acc.done + (t.status === 'done' ? 1 : 0),
        errors: acc.errors + (t.status === 'error' ? 1 : 0),
        tokens: acc.tokens + (t.input_tokens ?? 0) + (t.output_tokens ?? 0),
      }),
      { runs: 0, done: 0, errors: 0, tokens: 0 },
    );

    // Heartbeat tape — the within-run "I'm alive" signal, surfaced as a
    // chronological strip on the agent detail page below the Pulse card.
    const heartbeats = await recentHeartbeats(id, 30);

    return NextResponse.json({ agent: def, totals, tasks, heartbeats, editable });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
