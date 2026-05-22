// Executes cron jobs: spawns the configured KeyPlayer sub-agent with the job's
// payload.message, records the outcome in cron_runs, updates the job's last_*
// state, reschedules next_run_at, and drops a notification. Shared by the Vercel
// Cron dispatcher (/api/cron/dispatch) and the "Run now" button (/api/cron PUT).

import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';
import { spawnSubAgent } from './subagent';
import { computeNextRun } from './cron-expr';
import { appendKnowledgeSection } from './documents';
import { kgPersistDirective } from './constraints';

interface DueJobRow {
  id: string;
  name: string | null;
  agent_id: string | null;
  enabled: boolean;
  schedule_expr: string;
  schedule_tz: string;
  payload: { message?: string; saveToKb?: boolean; kbDoc?: string } & Record<string, unknown>;
}

function utcStamp(d = new Date()): string {
  return d.toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}

const SUMMARY_MAX = 500;
const RESULT_MAX = 8000;

async function notify(title: string, message: string, severity: 'info' | 'warning') {
  try {
    await sql()`
      INSERT INTO public.notifications (tenant_id, type, severity, title, message, data)
      VALUES (${DEFAULT_TENANT_ID}, 'cron', ${severity}, ${title}, ${message}, ${jsonb({})})
    `;
  } catch (err) {
    console.error('[cron-runner] notify failed:', (err as Error).message);
  }
}

/** Run one job row immediately. Records the run + reschedules. */
async function runOne(job: DueJobRow): Promise<{ id: string; status: 'ok' | 'error' }> {
  const startedAt = Date.now();
  const label = job.name || job.id;

  // Mark running so the board reflects it during the (slow) agent call.
  await sql()`
    UPDATE public.cron_jobs SET last_status = 'running', updated_at = now()
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${job.id}
  `;

  // Knowledge-base wiring: on by default so cron output is reusable by the rest
  // of the team. Set payload.saveToKb=false to opt out; payload.kbDoc names the
  // target document (defaults to a per-job "intel log").
  const saveToKb = job.payload?.saveToKb !== false;
  const kbDoc =
    (typeof job.payload?.kbDoc === 'string' && job.payload.kbDoc.trim()) ||
    `${label} — intel log`;

  let status: 'ok' | 'error' = 'ok';
  let summary: string | null = null;
  let errorText: string | null = null;
  let fullResult: string | null = null;
  let savedTo: string | null = null;

  if (!job.agent_id) {
    status = 'error';
    errorText = 'No agent configured for this job';
  } else if (!job.payload?.message) {
    status = 'error';
    errorText = 'Job has no payload.message';
  } else {
    // spawnSubAgent picks + applies the constraint variant centrally. We only add
    // the kg_remember directive (with tier-derived confidence) when feeding the KB.
    const message =
      String(job.payload.message) +
      (saveToKb ? `\n\n# ${kgPersistDirective()}` : '');
    try {
      const res = await spawnSubAgent(job.agent_id, message);
      if (res.ok) {
        fullResult = (res.text ?? '').slice(0, RESULT_MAX);
        summary = (res.text ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) || null;
        // Persist the readable digest into the editable KB doc.
        if (saveToKb && fullResult) {
          try {
            await appendKnowledgeSection(kbDoc, `${label} — ${utcStamp()}`, fullResult);
            savedTo = kbDoc;
          } catch (err) {
            console.error(`[cron-runner] KB save failed for ${job.id}:`, (err as Error).message);
          }
        }
      } else {
        status = 'error';
        errorText = res.error ?? 'Sub-agent returned no result';
      }
    } catch (err) {
      status = 'error';
      errorText = (err as Error).message;
    }
  }

  const durationMs = Date.now() - startedAt;
  const next = job.enabled ? computeNextRun(job.schedule_expr, job.schedule_tz) : null;
  const nextIso = next ? next.toISOString() : null;

  await sql()`
    UPDATE public.cron_jobs SET
      last_run_at = now(), last_status = ${status}, last_duration_ms = ${durationMs},
      last_error = ${errorText}, last_result = ${fullResult},
      next_run_at = ${nextIso}, updated_at = now()
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${job.id}
  `;

  await sql()`
    INSERT INTO public.cron_runs (tenant_id, job_id, status, duration_ms, summary, error, next_run_at)
    VALUES (${DEFAULT_TENANT_ID}, ${job.id}, ${status}, ${durationMs}, ${summary}, ${errorText}, ${nextIso})
  `;

  const secs = Math.round(durationMs / 1000);
  if (status === 'ok') {
    const kb = savedTo ? ` Saved to knowledge base → "${savedTo}".` : '';
    await notify(`Cron "${label}" completed`, `${job.agent_id} finished in ${secs}s.${kb}`, 'info');
  } else {
    await notify(`Cron "${label}" failed`, errorText || 'Unknown error', 'warning');
  }

  return { id: job.id, status };
}

async function loadJob(id: string): Promise<DueJobRow | null> {
  const rows = (await sql()`
    SELECT id, name, agent_id, enabled, schedule_expr, schedule_tz, payload
    FROM public.cron_jobs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id}
  `) as unknown as DueJobRow[];
  return rows[0] ?? null;
}

/** Run a single job by id, now (used by "Run now"). */
export async function runCronJob(id: string): Promise<{ ran: boolean; status?: 'ok' | 'error'; error?: string }> {
  const job = await loadJob(id);
  if (!job) return { ran: false, error: 'Not found' };
  const r = await runOne(job);
  return { ran: true, status: r.status };
}

/**
 * Run every enabled job whose next_run_at has passed. Called by the hourly
 * Vercel Cron dispatcher. Jobs run sequentially to respect sub-agent rate
 * limits and keep within the function's memory/CPU budget.
 */
export async function runDueJobs(): Promise<{ ran: number; results: Array<{ id: string; status: string }> }> {
  const due = (await sql()`
    SELECT id, name, agent_id, enabled, schedule_expr, schedule_tz, payload
    FROM public.cron_jobs
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
      AND enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT 25
  `) as unknown as DueJobRow[];

  const results: Array<{ id: string; status: string }> = [];
  for (const job of due) {
    try {
      const r = await runOne(job);
      results.push(r);
    } catch (err) {
      results.push({ id: job.id, status: 'error' });
      console.error(`[cron-runner] job ${job.id} threw:`, (err as Error).message);
    }
  }
  return { ran: results.length, results };
}
