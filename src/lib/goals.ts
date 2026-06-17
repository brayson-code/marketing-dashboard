import { sql, jsonb, tenantId } from './db/client';

// Goals + progress are persisted in Postgres (Supabase) — tables `goals` and
// `goal_progress` (see supabase/migrations/0003_goals_memory.sql). This replaces
// the previous filesystem store at state/keyplayer/goals.md so writes work on a
// read-only serverless host (Vercel).

export type GoalStatus = 'active' | 'pending_verification' | 'done' | 'abandoned' | 'paused';

export interface GoalProgress {
  ts: string; // ISO date (YYYY-MM-DD)
  note: string;
}

export interface Goal {
  id: string;
  title: string;
  owner: string;
  status: GoalStatus;
  created: string; // ISO date (YYYY-MM-DD)
  due?: string | null;
  success: string;
  progress: GoalProgress[];
}

// Row shapes as returned by postgres.js.
interface GoalRow {
  id: string;
  title: string;
  success: string;
  due: Date | null;
  status: GoalStatus;
  evidence: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
}

interface ProgressRow {
  goal_id: string;
  note: string;
  created_at: Date;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function genId(): string {
  return `g-${todayISO()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dateOnly(d: Date | null): string | null {
  if (!d) return null;
  // postgres.js returns `date` columns as JS Date at UTC midnight; `timestamptz`
  // as a full Date. Either way we want the YYYY-MM-DD slice.
  return new Date(d).toISOString().slice(0, 10);
}

function mapGoal(row: GoalRow, progress: ProgressRow[]): Goal {
  const owner = typeof row.metadata?.owner === 'string' ? (row.metadata.owner as string) : 'owner';
  return {
    id: row.id,
    title: row.title,
    owner,
    status: row.status,
    created: dateOnly(row.created_at) ?? todayISO(),
    due: dateOnly(row.due),
    success: row.success,
    progress: progress
      .filter((p) => p.goal_id === row.id)
      .map((p) => ({ ts: dateOnly(p.created_at) ?? todayISO(), note: p.note })),
  };
}

/** A self-check directive injected at the top of every sub-agent's task message
 *  when that agent owns an active goal. Forces the model to re-state the
 *  success criterion verbatim and outline how the run advances it BEFORE doing
 *  the work — a free, cold-cheap thinking aid (no second model call). The
 *  prefer-north-star ordering means the most important goal is the one the
 *  agent reasons against when it owns multiple. Returns '' when the agent has
 *  no owned goal (no self-check to do). */
export async function goalDirectiveForAgent(agentId: string): Promise<string> {
  try {
    const rows = (await sql()`
      SELECT id, title, success,
             to_char(due, 'YYYY-MM-DD') AS due,
             metadata->>'is_north_star' AS is_north_star
      FROM public.goals
      WHERE tenant_id = ${tenantId()}
        AND metadata->>'owner_agent' = ${agentId}
        AND status IN ('active', 'pending_verification')
      ORDER BY (metadata->>'is_north_star')::bool DESC NULLS LAST,
               due ASC NULLS LAST
      LIMIT 1
    `) as unknown as Array<{ id: string; title: string; success: string; due: string | null; is_north_star: string | null }>;
    const g = rows[0];
    if (!g) return '';
    const isNorthStar = g.is_north_star === 'true';
    return [
      `# Goal self-check (do this BEFORE the work)`,
      `Your owned goal${isNorthStar ? ' (the North Star)' : ''}: ${g.title}`,
      `Success criterion (verbatim — do NOT paraphrase): ${g.success}`,
      g.due ? `Due: ${g.due}.` : '',
      ``,
      `Open your response with a single \`<self-check>\` block (XML-style) containing exactly three lines:`,
      `  Step 0: Re-state the success criterion verbatim.`,
      `  Step 1: In ≤3 short bullets, outline how THIS run advances that criterion. If it doesn't, say so plainly and propose what would.`,
      `  Step 2: One sentence — your plan for the deliverable.`,
      `Then close the block and produce the deliverable as you normally would. Don't repeat the self-check in the deliverable.`,
    ].filter(Boolean).join('\n');
  } catch (e) {
    // Self-check is a nice-to-have; never block the run on goal lookup failures.
    console.error('[goalDirectiveForAgent] failed:', (e as Error).message);
    return '';
  }
}

/** Load all goals (any status) with their progress entries, newest goal first. */
export async function loadGoals(): Promise<Goal[]> {
  const goalRows = (await sql()`
    SELECT id, title, success, due, status, evidence, metadata, created_at, updated_at
    FROM goals
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC, id DESC
  `) as unknown as GoalRow[];
  if (goalRows.length === 0) return [];

  const progressRows = (await sql()`
    SELECT goal_id, note, created_at FROM goal_progress
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at ASC, id ASC
  `) as unknown as ProgressRow[];

  return goalRows.map((g) => mapGoal(g, progressRows));
}

/** Load a single goal (any status) with its progress, or null if not found. */
async function loadGoal(goalId: string): Promise<Goal | null> {
  const goalRows = (await sql()`
    SELECT id, title, success, due, status, evidence, metadata, created_at, updated_at
    FROM goals
    WHERE tenant_id = ${tenantId()} AND id = ${goalId}
  `) as unknown as GoalRow[];
  if (goalRows.length === 0) return null;

  const progressRows = (await sql()`
    SELECT goal_id, note, created_at FROM goal_progress
    WHERE tenant_id = ${tenantId()} AND goal_id = ${goalId}
    ORDER BY created_at ASC, id ASC
  `) as unknown as ProgressRow[];

  return mapGoal(goalRows[0], progressRows);
}

export async function listActiveGoals(): Promise<Goal[]> {
  const goals = await loadGoals();
  return goals.filter((g) => g.status === 'active' || g.status === 'pending_verification');
}

export async function createGoal(input: {
  title: string;
  owner?: string;
  success: string;
  due?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<Goal> {
  const id = genId();
  const owner = input.owner ?? 'owner';
  // Caller-supplied metadata keys override defaults except `owner`, which always
  // wins so the existing "owner stored in metadata.owner" invariant holds.
  const metadata = { ...(input.metadata ?? {}), owner };
  await sql()`
    INSERT INTO goals (id, tenant_id, title, success, due, status, metadata)
    VALUES (
      ${id}, ${tenantId()}, ${input.title}, ${input.success},
      ${input.due ?? null}, 'active', ${jsonb(metadata)}
    )
  `;
  const goal = await loadGoal(id);
  if (!goal) throw new Error(`Failed to create goal ${id}`);
  return goal;
}

export async function appendProgress(goalId: string, note: string): Promise<Goal | null> {
  const rows = await sql()`
    INSERT INTO goal_progress (tenant_id, goal_id, note)
    SELECT ${tenantId()}, ${goalId}, ${note}
    WHERE EXISTS (
      SELECT 1 FROM goals WHERE id = ${goalId} AND tenant_id = ${tenantId()}
    )
    RETURNING id
  `;
  if (rows.length === 0) return null; // goal does not exist
  // Touch the goal so updated_at reflects the latest activity.
  await sql()`
    UPDATE goals SET updated_at = now()
    WHERE id = ${goalId} AND tenant_id = ${tenantId()}
  `;
  return loadGoal(goalId);
}

export async function updateGoalStatus(goalId: string, status: GoalStatus, note?: string): Promise<Goal | null> {
  const rows = await sql()`
    UPDATE goals
    SET status = ${status},
        evidence = COALESCE(${note ?? null}, evidence),
        updated_at = now()
    WHERE id = ${goalId} AND tenant_id = ${tenantId()}
    RETURNING id
  `;
  if (rows.length === 0) return null; // goal does not exist
  if (note) {
    await sql()`
      INSERT INTO goal_progress (tenant_id, goal_id, note)
      VALUES (${tenantId()}, ${goalId}, ${`[status -> ${status}] ${note}`})
    `;
  }
  return loadGoal(goalId);
}
