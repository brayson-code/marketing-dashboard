// Executes cron jobs: spawns the configured KeyPlayer sub-agent with the job's
// payload.message, records the outcome in cron_runs, updates the job's last_*
// state, reschedules next_run_at, and drops a notification. Shared by the Vercel
// Cron dispatcher (/api/cron/dispatch) and the "Run now" button (/api/cron PUT).

import { sql, jsonb, tenantId } from './db/client';
import { runWithTenant } from './tenant';
import { spawnSubAgent } from './subagent';
import { computeNextRun } from './cron-expr';
import { appendKnowledgeSection } from './documents';
import { kgPersistDirective } from './constraints';

// Budget guard — dynamically imported so missing module (pre-integration) is safe.
// isBudgetBlock(err) returns true when a BudgetExceededError is thrown OR when
// spawnSubAgent returns { ok: false, blocked: true } (defensive dual-shape support).
async function isBudgetExceeded(err: unknown): Promise<boolean> {
  try {
    const mod = await import('./usage-cap');
    return err instanceof mod.BudgetExceededError;
  } catch {
    // Module not yet present — treat as not exceeded (enforcement is inert).
    return false;
  }
}

function isBlockedResult(res: unknown): boolean {
  return (
    typeof res === 'object' &&
    res !== null &&
    (res as Record<string, unknown>).ok === false &&
    (res as Record<string, unknown>).blocked === true
  );
}

interface DueJobRow {
  id: string;
  name: string | null;
  agent_id: string | null;
  enabled: boolean;
  schedule_expr: string;
  schedule_tz: string;
  payload: { kind?: string; message?: string; saveToKb?: boolean; kbDoc?: string } & Record<string, unknown>;
  delivery: { channel?: string } & Record<string, unknown> | null;
}

function utcStamp(d = new Date()): string {
  return d.toISOString().replace('T', ' ').replace(/:\d\d\.\d+Z$/, ' UTC');
}

/** Record a budget-skipped tick in cron_runs so the skip is visible in run
 *  history (not a silent gap). Best-effort — never blocks the skip path. */
async function recordSkip(jobId: string, nextIso: string | null): Promise<void> {
  await sql()`
    INSERT INTO public.cron_runs (tenant_id, job_id, status, duration_ms, summary, error, next_run_at)
    VALUES (${tenantId()}, ${jobId}, 'skipped', 0, ${'Skipped — daily token budget reached'}, ${'Budget limit reached — retrying next tick'}, ${nextIso})
  `.catch(() => {});
}

const SUMMARY_MAX = 500;
const RESULT_MAX = 8000;

async function notify(title: string, message: string, severity: 'info' | 'warning') {
  try {
    await sql()`
      INSERT INTO public.notifications (tenant_id, type, severity, title, message, data)
      VALUES (${tenantId()}, 'cron', ${severity}, ${title}, ${message}, ${jsonb({})})
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
    WHERE tenant_id = ${tenantId()} AND id = ${job.id}
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

  if (job.payload?.kind === 'watchlist') {
    // Competitor watchlist sweep. Unlike agent jobs, this doesn't spawn a single
    // sub-agent off payload.message — it walks every due competitor, scrapes their
    // recent reels, and analyzes the top new performer(s) (which internally spawns
    // reel-analyst per reel). Dynamic import keeps reel-intel out of the dispatcher's
    // base bundle and matches the buildAgentAugment best-effort pattern.
    try {
      const { runWatchlistDue } = await import('./reel-intel');
      const r = await runWatchlistDue();
      summary = `Watchlist swept: checked ${r.checked} competitor(s), analyzed ${r.analyzed} reel(s).`;
      fullResult = summary;
    } catch (err) {
      status = 'error';
      errorText = (err as Error).message;
    }
  } else if (!job.agent_id) {
    status = 'error';
    errorText = 'No agent configured for this job';
  } else if (!job.payload?.message) {
    status = 'error';
    errorText = 'Job has no payload.message';
  } else {
    // spawnSubAgent picks + applies the constraint variant centrally. We only add
    // the kg_remember directive (with tier-derived confidence) when feeding the KB.
    // Per-agent augmenters: inject live signals the agent should reason about
    // (e.g. AI CMO needs the channel's actual numbers for a weekly brand review,
    // not a vibes-based recap). Each augmenter is best-effort + null-safe.
    const augment = await buildAgentAugment(job.agent_id);
    const message =
      String(job.payload.message) +
      (augment ? `\n\n${augment}` : '') +
      (saveToKb ? `\n\n# ${kgPersistDirective()}` : '');
    try {
      const res = await spawnSubAgent(job.agent_id, message);

      // Budget-exceeded: the spawn chokepoint blocked this job before any LLM
      // call was made. Do NOT mark it 'error' — just skip silently, reschedule
      // normally, and log. The job will retry on its next scheduled tick.
      if (isBlockedResult(res)) {
        const blocked = res as { ok: false; blocked: true; error?: string };
        console.warn(
          `[cron] tenant ${tenantId()} over daily token budget — skipping job "${label}", will retry next tick. reason: ${blocked.error ?? 'budget exceeded'}`,
        );
        // Mark last_status as 'skipped' (not 'error') so the board doesn't alarm.
        const skipNext = job.enabled ? (computeNextRun(job.schedule_expr, job.schedule_tz)?.toISOString() ?? null) : null;
        await sql()`
          UPDATE public.cron_jobs SET
            last_status = 'skipped', last_error = ${'Budget limit reached — retrying next tick'},
            next_run_at = ${skipNext},
            updated_at = now()
          WHERE tenant_id = ${tenantId()} AND id = ${job.id}
        `;
        await recordSkip(job.id, skipNext);
        return { id: job.id, status: 'skipped' as 'ok' | 'error' };
      }

      if (res.ok) {
        fullResult = (res.text ?? '').slice(0, RESULT_MAX);
        summary = (res.text ?? '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX) || null;

        // Delivery: push the digest to the owner over the chosen channel. Per-tenant
        // (uses THIS workspace's connected provider). Best-effort — a failed delivery
        // never fails the job. delivery = { channel: 'imessage' | 'email', to?: '…' }.
        const del = (job.delivery ?? {}) as { channel?: string; to?: string };
        if (del.channel === 'imessage' && fullResult.trim()) {
          try {
            const { sendIMessage } = await import('./loopmessage');
            const dr = await sendIMessage(fullResult.slice(0, 1400));
            if (!dr.ok) console.warn(`[cron] iMessage delivery failed for "${label}": ${dr.error}`);
          } catch (err) {
            console.warn(`[cron] iMessage delivery error for "${label}":`, (err as Error).message);
          }
        } else if (del.channel === 'email' && fullResult.trim()) {
          try {
            const { listInboxes, sendEmail } = await import('./agentmail');
            const to = String(del.to ?? '').trim();
            let fromInbox: string | undefined = (await listInboxes().catch(() => []))[0]?.inbox_id;
            if (!fromInbox) {
              // Key connected but no inbox yet — provision one so delivery "just works".
              const { provisionInbox } = await import('./agentmail-inboxes');
              fromInbox = (await provisionInbox({ agentId: job.agent_id ?? undefined }).catch(() => null))?.address;
            }
            if (fromInbox && to) {
              await sendEmail(fromInbox, { to: [to], subject: label, text: fullResult });
            } else {
              console.warn(`[cron] email delivery skipped for "${label}": ${!fromInbox ? 'no AgentMail inbox' : 'no recipient'}`);
            }
          } catch (err) {
            console.warn(`[cron] email delivery error for "${label}":`, (err as Error).message);
          }
        }
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
      // Budget-exceeded thrown as an exception (primary BudgetExceededError contract).
      if (await isBudgetExceeded(err)) {
        console.warn(
          `[cron] tenant ${tenantId()} over daily token budget — skipping job "${label}", will retry next tick.`,
        );
        const skipNext = job.enabled ? (computeNextRun(job.schedule_expr, job.schedule_tz)?.toISOString() ?? null) : null;
        await sql()`
          UPDATE public.cron_jobs SET
            last_status = 'skipped', last_error = ${'Budget limit reached — retrying next tick'},
            next_run_at = ${skipNext},
            updated_at = now()
          WHERE tenant_id = ${tenantId()} AND id = ${job.id}
        `;
        await recordSkip(job.id, skipNext);
        return { id: job.id, status: 'skipped' as 'ok' | 'error' };
      }
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
    WHERE tenant_id = ${tenantId()} AND id = ${job.id}
  `;

  await sql()`
    INSERT INTO public.cron_runs (tenant_id, job_id, status, duration_ms, summary, error, next_run_at)
    VALUES (${tenantId()}, ${job.id}, ${status}, ${durationMs}, ${summary}, ${errorText}, ${nextIso})
  `;

  const secs = Math.round(durationMs / 1000);
  if (status === 'ok') {
    const kb = savedTo ? ` Saved to knowledge base → "${savedTo}".` : '';
    const who = job.payload?.kind === 'watchlist' ? (summary ?? 'Watchlist swept') : `${job.agent_id} finished`;
    await notify(`Cron "${label}" completed`, `${who} in ${secs}s.${kb}`, 'info');
  } else {
    await notify(`Cron "${label}" failed`, errorText || 'Unknown error', 'warning');
  }

  return { id: job.id, status };
}

/** Build the per-agent live-signal block. Returns '' when there's nothing to
 *  add or the data sources are unavailable — never throws. The result is
 *  appended to the agent's cron payload.message just before dispatch. */
async function buildAgentAugment(agentId: string | null): Promise<string> {
  if (!agentId) return '';
  if (agentId !== 'ai-cmo') return ''; // only CMO consumes channel stats today
  try {
    const { isConnected, getChannelStats, last30DayMetrics } = await import('./youtube');
    if (!(await isConnected())) return '';
    const [ch, m] = await Promise.all([getChannelStats(), last30DayMetrics()]);
    if (!ch) return '';
    const lines: string[] = [];
    lines.push('# Live channel signals (read-only, current)');
    lines.push(`YouTube · ${ch.title || 'channel'}: ${ch.subscribers.toLocaleString()} subs · ${ch.views_total.toLocaleString()} total views · ${ch.videos_total} videos.`);
    if (m) {
      const netSubs = (m.net_subs > 0 ? '+' : '') + m.net_subs;
      lines.push(`Last 30d (${m.start} → ${m.end}): ${m.views.toLocaleString()} views · ${m.estimated_minutes_watched.toLocaleString()} watch min · avg view ${m.average_view_duration_sec}s · net subs ${netSubs}.`);
    }
    lines.push('Use these numbers verbatim where the brief asks about channel performance. Do not invent metrics.');
    return lines.join('\n');
  } catch (e) {
    console.error('[cron-runner] augment failed:', (e as Error).message);
    return '';
  }
}

async function loadJob(id: string): Promise<DueJobRow | null> {
  const rows = (await sql()`
    SELECT id, name, agent_id, enabled, schedule_expr, schedule_tz, payload, delivery
    FROM public.cron_jobs
    WHERE tenant_id = ${tenantId()} AND id = ${id}
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
  // The hourly Vercel dispatcher runs OUTSIDE any tenant context, so we select
  // due jobs across ALL tenants (the backend connects as the RLS-bypassing
  // postgres role, so this legitimately sees every tenant's rows) and run each
  // one INSIDE its owning tenant's context. Without runWithTenant, tenantId()
  // falls back to the system default (HQ) and only HQ's jobs would ever fire —
  // every other tenant's scheduled cron, incl. the competitor watchlist, would
  // silently never run.
  const due = (await sql()`
    SELECT id, name, agent_id, enabled, schedule_expr, schedule_tz, payload, delivery, tenant_id
    FROM public.cron_jobs
    WHERE enabled = true
      AND next_run_at IS NOT NULL
      AND next_run_at <= now()
    ORDER BY next_run_at ASC
    LIMIT 50
  `) as unknown as Array<DueJobRow & { tenant_id: string }>;

  const results: Array<{ id: string; status: string }> = [];
  for (const job of due) {
    try {
      const r = await runWithTenant({ tenantId: job.tenant_id, userId: null }, () => runOne(job));
      results.push(r);
    } catch (err) {
      // Budget errors thrown outside runOne (e.g. if the guard throws before
      // spawnSubAgent returns) — degrade gracefully, never count as 'error'.
      if (await isBudgetExceeded(err)) {
        console.warn(`[cron-runner] job ${job.id} skipped (budget exceeded for tenant ${job.tenant_id})`);
        results.push({ id: job.id, status: 'skipped' });
      } else {
        results.push({ id: job.id, status: 'error' });
        console.error(`[cron-runner] job ${job.id} threw:`, (err as Error).message);
      }
    }
  }
  return { ran: results.length, results };
}
