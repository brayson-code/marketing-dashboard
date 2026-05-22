import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';

export type TaskStatus = 'running' | 'done' | 'error' | 'cancelled';

export interface AgentTaskRow {
  id: number;
  agent_id: string;
  parent_id: number | null;
  status: TaskStatus;
  task: string;
  result: string | null;
  error: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  stream_text: string | null;
  started_at: Date;
  completed_at: Date | null;
  metadata: Record<string, unknown> | null;
}

/** Live transcript: overwrite a running task's in-progress output buffer. */
export async function setTaskStream(taskId: number, text: string): Promise<void> {
  await sql()`
    UPDATE agent_tasks SET stream_text = ${text}
    WHERE id = ${taskId} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

export async function startTask(agentId: string, task: string, parentId?: number, meta?: Record<string, unknown>): Promise<number> {
  const rows = await sql()`
    INSERT INTO agent_tasks (tenant_id, agent_id, parent_id, status, task, metadata)
    VALUES (${DEFAULT_TENANT_ID}, ${agentId}, ${parentId ?? null}, 'running', ${task}, ${meta ? jsonb(meta) : null})
    RETURNING id
  `;
  return Number(rows[0].id);
}

export async function finishTask(
  taskId: number,
  fields: { result?: string; error?: string; status?: TaskStatus; inputTokens?: number; outputTokens?: number },
): Promise<void> {
  const status: TaskStatus = fields.status ?? (fields.error ? 'error' : 'done');
  await sql()`
    UPDATE agent_tasks
    SET status = ${status},
        result = COALESCE(${fields.result ?? null}, result),
        error = COALESCE(${fields.error ?? null}, error),
        input_tokens = COALESCE(${fields.inputTokens ?? null}, input_tokens),
        output_tokens = COALESCE(${fields.outputTokens ?? null}, output_tokens),
        stream_text = null,
        completed_at = now()
    WHERE id = ${taskId} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

export async function listTasks(limit = 50): Promise<AgentTaskRow[]> {
  const rows = await sql()`
    SELECT * FROM agent_tasks
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY started_at DESC, id DESC
    LIMIT ${limit}
  `;
  return rows as unknown as AgentTaskRow[];
}
