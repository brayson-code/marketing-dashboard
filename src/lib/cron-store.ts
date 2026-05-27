// Supabase-backed cron store (replaces the OpenClaw filesystem jobs.json + log
// files). Reads/writes the cron_jobs + cron_runs tables and shapes rows into the
// nested { schedule, payload, state } object the existing CronBoard UI consumes,
// so the front end is unchanged. All queries scope tenant_id explicitly because
// the backend connects as the RLS-bypassing `postgres` role.

import { sql, jsonb, tenantId } from './db/client';
import { SUBAGENT_REGISTRY } from './subagent';
import { computeNextRun, isValidCron } from './cron-expr';

export const KNOWN_AGENTS = Object.keys(SUBAGENT_REGISTRY);

export function normalizeJobId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  if (!id || id.length > 128) return null;
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(id)) return null;
  return id;
}

// Shape returned to the browser — matches the CronBoard `CronJob` interface.
export interface CronJobView {
  id: string;
  name?: string;
  agentId?: string;
  skill?: string;
  enabled: boolean;
  schedule: { expr?: string; tz?: string };
  payload: Record<string, unknown>;
  delivery: Record<string, unknown>;
  lastRun?: string | null;
  lastResult?: string | null;
  state: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastDurationMs?: number;
    lastError?: string;
    nextRunAtMs?: number;
  };
}

interface CronJobRow {
  id: string;
  name: string | null;
  agent_id: string | null;
  skill: string | null;
  enabled: boolean;
  schedule_expr: string;
  schedule_tz: string;
  payload: Record<string, unknown> | null;
  delivery: Record<string, unknown> | null;
  last_run_at: Date | null;
  last_status: string | null;
  last_duration_ms: number | null;
  last_error: string | null;
  last_result: string | null;
  next_run_at: Date | null;
}

function ms(d: Date | null): number | undefined {
  return d ? new Date(d).getTime() : undefined;
}

function rowToView(r: CronJobRow): CronJobView {
  return {
    id: r.id,
    name: r.name ?? undefined,
    agentId: r.agent_id ?? undefined,
    skill: r.skill ?? undefined,
    enabled: r.enabled,
    schedule: { expr: r.schedule_expr, tz: r.schedule_tz },
    payload: r.payload ?? {},
    delivery: r.delivery ?? {},
    lastRun: r.last_run_at ? new Date(r.last_run_at).toISOString() : null,
    lastResult: r.last_result,
    state: {
      lastRunAtMs: ms(r.last_run_at),
      lastStatus: r.last_status ?? undefined,
      lastDurationMs: r.last_duration_ms ?? undefined,
      lastError: r.last_error ?? undefined,
      nextRunAtMs: ms(r.next_run_at),
    },
  };
}

export async function listCronJobs(): Promise<CronJobView[]> {
  const rows = (await sql()`
    SELECT id, name, agent_id, skill, enabled, schedule_expr, schedule_tz,
           payload, delivery, last_run_at, last_status, last_duration_ms,
           last_error, last_result, next_run_at
    FROM public.cron_jobs
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at ASC
  `) as unknown as CronJobRow[];
  return rows.map(rowToView);
}

// The editor sends the legacy nested shape: { id, name, agentId, skill,
// enabled, schedule:{expr,tz}, payload, delivery }. Normalize + validate it.
interface EditorJob {
  id?: string;
  jobId?: string;
  name?: string;
  agentId?: string;
  skill?: string;
  enabled?: boolean;
  schedule?: { expr?: string; tz?: string };
  payload?: Record<string, unknown>;
  delivery?: Record<string, unknown>;
}

interface NormalizedJob {
  id: string;
  name: string | null;
  agentId: string | null;
  skill: string | null;
  enabled: boolean;
  expr: string;
  tz: string;
  payload: Record<string, unknown>;
  delivery: Record<string, unknown>;
}

function normalizeEditorJob(job: EditorJob): NormalizedJob {
  const id = normalizeJobId(job.id ?? job.jobId);
  if (!id) throw new Error('Invalid job id (use letters, digits, - or _)');

  const expr = String(job.schedule?.expr ?? '').trim();
  if (!expr) throw new Error('schedule.expr is required (5-field cron, e.g. "0 9 * * 1-5")');
  if (!isValidCron(expr)) throw new Error(`Invalid cron expression: "${expr}"`);

  const agentId = job.agentId ? String(job.agentId).trim() : null;
  if (agentId && !KNOWN_AGENTS.includes(agentId)) {
    throw new Error(`Unknown agent "${agentId}". Pick one of: ${KNOWN_AGENTS.join(', ')}`);
  }
  if (!agentId) throw new Error(`agentId is required. Pick one of: ${KNOWN_AGENTS.join(', ')}`);

  const message = String((job.payload?.message ?? '')).trim();
  if (!message) throw new Error('payload.message is required — tell the agent what to do');

  return {
    id,
    name: job.name ? String(job.name).slice(0, 120) : null,
    agentId,
    skill: job.skill ? String(job.skill).slice(0, 64) : null,
    enabled: job.enabled !== false,
    expr,
    tz: (job.schedule?.tz || 'UTC').trim(),
    payload: job.payload && typeof job.payload === 'object' ? job.payload : {},
    delivery: job.delivery && typeof job.delivery === 'object' ? job.delivery : {},
  };
}

export async function jobExists(id: string): Promise<boolean> {
  const rows = await sql()`
    SELECT 1 FROM public.cron_jobs WHERE tenant_id = ${tenantId()} AND id = ${id} LIMIT 1
  `;
  return rows.length > 0;
}

export async function createCronJob(job: EditorJob): Promise<void> {
  const n = normalizeEditorJob(job);
  if (await jobExists(n.id)) throw new Error(`Job "${n.id}" already exists`);
  const next = computeNextRun(n.expr, n.tz);
  await sql()`
    INSERT INTO public.cron_jobs
      (tenant_id, id, name, agent_id, skill, enabled, schedule_expr, schedule_tz, payload, delivery, next_run_at)
    VALUES
      (${tenantId()}, ${n.id}, ${n.name}, ${n.agentId}, ${n.skill}, ${n.enabled},
       ${n.expr}, ${n.tz}, ${jsonb(n.payload)}, ${jsonb(n.delivery)}, ${next ? next.toISOString() : null})
  `;
}

export async function updateCronJob(job: EditorJob): Promise<void> {
  const n = normalizeEditorJob(job);
  if (!(await jobExists(n.id))) throw new Error('Not found');
  const next = n.enabled ? computeNextRun(n.expr, n.tz) : null;
  await sql()`
    UPDATE public.cron_jobs SET
      name = ${n.name}, agent_id = ${n.agentId}, skill = ${n.skill}, enabled = ${n.enabled},
      schedule_expr = ${n.expr}, schedule_tz = ${n.tz},
      payload = ${jsonb(n.payload)}, delivery = ${jsonb(n.delivery)},
      next_run_at = ${next ? next.toISOString() : null}, updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${n.id}
  `;
}

export async function deleteCronJob(idInput: unknown): Promise<void> {
  const id = normalizeJobId(idInput);
  if (!id) throw new Error('Invalid id');
  const res = await sql()`
    DELETE FROM public.cron_jobs WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
  if (res.count === 0) throw new Error('Not found');
}

/** Toggle enabled. When re-enabling, recompute next_run_at from the schedule. */
export async function toggleCronJob(idInput: unknown): Promise<void> {
  const id = normalizeJobId(idInput);
  if (!id) throw new Error('Invalid id');
  const rows = (await sql()`
    SELECT enabled, schedule_expr, schedule_tz FROM public.cron_jobs
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as Array<{ enabled: boolean; schedule_expr: string; schedule_tz: string }>;
  if (rows.length === 0) throw new Error('Not found');
  const nowEnabled = !rows[0].enabled;
  const next = nowEnabled ? computeNextRun(rows[0].schedule_expr, rows[0].schedule_tz) : null;
  await sql()`
    UPDATE public.cron_jobs
    SET enabled = ${nowEnabled}, next_run_at = ${next ? next.toISOString() : null}, updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
}

/** "Run now": mark the job due immediately so the next dispatcher pass runs it. */
export async function markDue(idInput: unknown): Promise<void> {
  const id = normalizeJobId(idInput);
  if (!id) throw new Error('Invalid id');
  const res = await sql()`
    UPDATE public.cron_jobs SET next_run_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
  if (res.count === 0) throw new Error('Not found');
}

// ── Runs ──────────────────────────────────────────────────────────────────

export interface CronRunView {
  ts: string;
  status: string;
  durationMs: number | null;
  summary: string | null;
  error: string | null;
  nextRunAtMs: number | null;
}

export async function listRuns(jobIdInput: unknown, limit = 10): Promise<CronRunView[]> {
  const id = normalizeJobId(jobIdInput);
  if (!id) return [];
  const n = Math.max(1, Math.min(50, Math.floor(limit)));
  const rows = (await sql()`
    SELECT started_at, status, duration_ms, summary, error, next_run_at
    FROM public.cron_runs
    WHERE tenant_id = ${tenantId()} AND job_id = ${id}
    ORDER BY started_at DESC
    LIMIT ${n}
  `) as unknown as Array<{
    started_at: Date; status: string; duration_ms: number | null;
    summary: string | null; error: string | null; next_run_at: Date | null;
  }>;
  return rows.map((r) => ({
    ts: new Date(r.started_at).toISOString(),
    status: r.status,
    durationMs: r.duration_ms,
    summary: r.summary,
    error: r.error,
    nextRunAtMs: r.next_run_at ? new Date(r.next_run_at).getTime() : null,
  }));
}
