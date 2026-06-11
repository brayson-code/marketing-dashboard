import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { sql, tenantId } from '@/lib/db/client';
import { getHermesStateDir } from '@/lib/hermes-state';
import { requireApiUser } from '@/lib/api-auth';
import { getInstance, resolveOpenClawPaths } from '@/lib/instances';
import { memo } from '@/lib/cache';

export const dynamic = 'force-dynamic';

const STATE_DIR = getHermesStateDir();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getInstanceId(request: Request): string | null {
  try {
    const url = new URL(request.url);
    return url.searchParams.get('instance') || url.searchParams.get('namespace');
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;

  try {
    const instance = getInstance(getInstanceId(request));

    const data = await memo(`hud:${tenantId()}:${instance.id}`, 10000, async () => {
    const { cronDir } = resolveOpenClawPaths(instance);

    const s = sql();

    const sendingPausedPath = path.join(STATE_DIR, 'sending-paused.flag');
    const sending_paused = fs.existsSync(sendingPausedPath);

    let paused_reason: string | null = null;
    if (sending_paused) {
      try {
        paused_reason =
          fs.readFileSync(sendingPausedPath, 'utf-8').trim().split('\n')[0] || 'Paused';
      } catch {
        paused_reason = 'Paused';
      }
    }

    // Real sources:
    //   approvals_pending = agent_drafts.status = 'pending'   (your pile — what's waiting on you)
    //   approvals_stale   = same, but older than 24h          (chasing the user)
    //   in_flight         = wave_runs.running + agent_tasks.running
    //                                                         (their pile — what's happening for you right now)
    //   waves_pending     = wave_step_runs.status = 'pending' (queued waves; surfaces in the kanban Up Next)
    // The legacy content_posts/sequences tables are V0 and now empty on most
    // tenants — querying them gave the dashboard a permanent zero before.
    const [draftsPendingRows, draftsStaleRows, wavesPendingRows, tasksRunningRows, missionsRunningRows] = await Promise.all([
      s`SELECT COUNT(*) AS c FROM public.agent_drafts WHERE tenant_id = ${tenantId()} AND status = 'pending'`,
      s`SELECT COUNT(*) AS c FROM public.agent_drafts WHERE tenant_id = ${tenantId()} AND status = 'pending' AND created_at < now() - interval '24 hours'`,
      s`SELECT COUNT(*) AS c FROM public.wave_step_runs WHERE tenant_id = ${tenantId()} AND status = 'pending'`,
      s`SELECT COUNT(*) AS c FROM public.agent_tasks WHERE tenant_id = ${tenantId()} AND status = 'running'`,
      s`SELECT COUNT(*) AS c FROM public.wave_runs WHERE tenant_id = ${tenantId()} AND status = 'running'`,
    ]);

    const drafts_pending     = Number(draftsPendingRows[0]?.c ?? 0);
    const drafts_stale       = Number(draftsStaleRows[0]?.c ?? 0);
    const waves_pending      = Number(wavesPendingRows[0]?.c ?? 0);
    const tasks_running      = Number(tasksRunningRows[0]?.c ?? 0);
    const missions_running   = Number(missionsRunningRows[0]?.c ?? 0);
    // In Flight = what your agents are actively working on RIGHT NOW. Pairs
    // with approvals_pending as a clean opposite — their pile vs. yours.
    const in_flight          = missions_running + tasks_running;

    let cron_total = 0;
    let cron_errors = 0;
    try {
      const jobsPath = path.join(cronDir, 'jobs.json');
      const raw = fs.readFileSync(jobsPath, 'utf-8');
      const parsed: unknown = JSON.parse(raw);
      const jobs: unknown[] =
        Array.isArray(parsed)
          ? parsed
          : isRecord(parsed) && Array.isArray(parsed.jobs)
            ? (parsed.jobs as unknown[])
            : [];
      cron_total = jobs.length;
      cron_errors = jobs.filter((j) => {
        if (!isRecord(j)) return false;
        const enabled = j.enabled;
        if (enabled === false) return false;
        const state = j.state;
        if (!isRecord(state)) return false;
        const lastStatus = state.lastStatus;
        return typeof lastStatus === 'string' && lastStatus !== 'ok';
      }).length;
    } catch {
      // ignore
    }

    return {
      instance: instance.id,
      sending_paused,
      paused_reason,
      approvals_pending: drafts_pending,
      approvals_stale: drafts_stale,
      in_flight,
      missions_running,
      tasks_running,
      waves_pending,
      cron_total,
      cron_errors,
    };
    });

    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
