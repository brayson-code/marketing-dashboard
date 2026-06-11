// Agent heartbeat — the real-time "I'm alive" tape. One row per beat in
// agent_heartbeats. Surfaced on hero cards as a freshness-glow ticker and on
// /agents/[id] as a tape of recent beats. Strictly best-effort: heartbeat
// emission must never block or fail an agent run.

import { sql, tenantId } from './db/client';

export type HeartbeatKind = 'start' | 'progress' | 'finished' | 'errored' | 'tick';

export interface Heartbeat {
  agent_id: string;
  ts: number;       // epoch seconds
  kind: HeartbeatKind;
  message: string;
  task_id: number | null;
}

/** Emit a single beat. Never throws — swallows any error so the agent's actual
 *  work never depends on the telemetry table being healthy. */
export async function heartbeat(
  agentId: string,
  kind: HeartbeatKind,
  message: string = '',
  taskId: number | null = null,
): Promise<void> {
  try {
    const msg = (message ?? '').slice(0, 280); // hard-cap so a runaway log line doesn't bloat
    await sql()`
      INSERT INTO public.agent_heartbeats (tenant_id, agent_id, kind, message, task_id)
      VALUES (${tenantId()}, ${agentId}, ${kind}, ${msg}, ${taskId})
    `;
  } catch (e) {
    console.error('[heartbeat] emit failed:', (e as Error).message);
  }
}

/** The latest beat per agent in the current tenant. Used by /api/hero-agents to
 *  light up the hero-card tickers with "currently: X" or "12s ago: Y". */
export async function latestHeartbeatsByAgent(): Promise<Map<string, Heartbeat>> {
  try {
    const rows = (await sql()`
      SELECT DISTINCT ON (agent_id)
             agent_id, kind, message, task_id,
             extract(epoch from ts)::int AS ts
      FROM public.agent_heartbeats
      WHERE tenant_id = ${tenantId()}
        AND ts >= now() - interval '1 day'
      ORDER BY agent_id, ts DESC
    `) as unknown as Array<{ agent_id: string; kind: HeartbeatKind; message: string; task_id: number | null; ts: number }>;
    const m = new Map<string, Heartbeat>();
    for (const r of rows) m.set(r.agent_id, r);
    return m;
  } catch {
    return new Map();
  }
}

/** Recent tape for one agent — used by the agent detail page. */
export async function recentHeartbeats(agentId: string, limit = 50): Promise<Heartbeat[]> {
  try {
    const rows = (await sql()`
      SELECT agent_id, kind, message, task_id,
             extract(epoch from ts)::int AS ts
      FROM public.agent_heartbeats
      WHERE tenant_id = ${tenantId()} AND agent_id = ${agentId}
      ORDER BY ts DESC
      LIMIT ${limit}
    `) as unknown as Heartbeat[];
    return rows;
  } catch {
    return [];
  }
}
