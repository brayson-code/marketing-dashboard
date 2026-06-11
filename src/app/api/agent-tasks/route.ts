import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse, after } from 'next/server';
import { listTasks } from '@/lib/agent-tasks';
import { spawnSubAgent } from '@/lib/subagent';
import { tenantId, currentUserId, runWithTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 300; // a dispatched follow-up runs the agent in the background

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const tasks = await listTasks(limit);
  const running = tasks.filter((t) => t.status === 'running').length;
  return NextResponse.json({ tasks, counts: { running, total: tasks.length } });
}

// POST /api/agent-tasks { agent_id, task } → dispatch a fresh run to that agent in
// the background. Powers the Tasks board's task drawer: refine an instruction and
// "work on it" without leaving the board. The run records itself (startTask) so it
// shows up live in the Doing column. BYO-key gated inside spawnSubAgent.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  let body: { agent_id?: string; task?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const agentId = (body.agent_id ?? '').trim();
  const task = (body.task ?? '').trim();
  if (!agentId || !task) {
    return NextResponse.json({ error: 'agent_id and task are required' }, { status: 400 });
  }

  // Capture the tenant so the deferred run (after()) — outside this request's
  // AsyncLocalStorage scope — executes under the right workspace.
  const ctx = { tenantId: tenantId(), userId: currentUserId() };
  after(() =>
    runWithTenant(ctx, async () => {
      try {
        const r = await spawnSubAgent(agentId, task);
        if (!r.ok) console.error(`[agent-tasks dispatch] ${agentId}:`, r.error);
      } catch (e) {
        console.error('[agent-tasks dispatch] unexpected:', (e as Error).message);
      }
    }),
  );

  return NextResponse.json({ ok: true, dispatched: agentId }, { status: 202 });
}
