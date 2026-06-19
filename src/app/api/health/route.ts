import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiUser } from '@/lib/api-auth';
import { memo } from '@/lib/cache';
import { listProviderStatus } from '@/lib/nango';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Real system-health signal for the nav-rail card. We don't store a health
// number anywhere — it's derived live from the things that actually break:
// agent runs erroring, tasks stuck past the serverless ceiling, cron jobs
// failing, and integrations dropping. Score starts at 100 and each problem
// subtracts a weighted penalty + emits an alert the owner can click into.
// Cached 15s so the 30s nav poll is nearly free.

export type AlertSeverity = 'critical' | 'warning' | 'info';
export interface HealthAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail?: string;
  href?: string;
}
export type LivenessState = 'ok' | 'down';
export type BlobLivenessState = LivenessState | 'unconfigured';
export interface HealthPayload {
  score: number;
  status: 'healthy' | 'degraded' | 'down';
  alerts: HealthAlert[];
  trend: number[];        // 14-day daily success-rate %, oldest → newest
  activity24h: number;    // agent runs in the last 24h (0 = idle)
  // Infra liveness probes (additive — the nav-rail consumer ignores them and
  // keeps reading score/status/alerts). db = a trivial SELECT 1; blob = whether
  // the Vercel Blob store is reachable ('unconfigured' when no token on this env).
  db: LivenessState;
  blob: BlobLivenessState;
  checkedAt: string;
}

const SAFE: HealthPayload = {
  score: 100, status: 'healthy', alerts: [], trend: [], activity24h: 0,
  db: 'ok', blob: 'unconfigured', checkedAt: '',
};

export async function GET(req: NextRequest) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  try {
    const data = await memo(`health:${tenantId()}`, 15_000, computeHealth);
    return NextResponse.json(data);
  } catch {
    // Never let the health widget itself be the thing that breaks.
    return NextResponse.json({ ...SAFE, checkedAt: new Date().toISOString() });
  }
}

// NOTE: these probe helpers are intentionally NOT exported. A Next.js route
// module may only export the HTTP-verb handlers + route config — exporting a
// helper trips the generated route-type check. The reusable copies live in
// src/lib/uptime.ts for the cron path.

/** DB liveness — a trivial round-trip. 'down' on any error (connection, pooler,
 *  auth). Tenant-agnostic by design: it only proves the database answers. */
async function probeDb(): Promise<LivenessState> {
  try {
    await sql()`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

/** Blob-store liveness. 'unconfigured' when no token on this env (normal in local
 *  dev). Otherwise we HEAD a path we expect to NOT exist: a BlobNotFoundError means
 *  the store answered (reachable → 'ok'); any other failure (network/auth) → 'down'. */
async function probeBlob(): Promise<BlobLivenessState> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return 'unconfigured';
  try {
    const { head, BlobNotFoundError } = await import('@vercel/blob');
    try {
      await head(`__healthcheck__/does-not-exist-${Date.now()}`, { token });
      // Unexpected success still proves reachability.
      return 'ok';
    } catch (err) {
      // A "not found" is the expected, healthy answer — the store responded.
      if (err instanceof BlobNotFoundError) return 'ok';
      // Anything else (auth/network) means the store itself is unreachable.
      return 'down';
    }
  } catch {
    // SDK import or unexpected failure — treat as down rather than crash health.
    return 'down';
  }
}

async function computeHealth(): Promise<HealthPayload> {
  const s = sql();
  const tid = tenantId();

  const [taskAgg, stuckRows, cronRows, trendRows, dbState, blobState] = await Promise.all([
    s`SELECT count(*)::int AS total,
             count(*) FILTER (WHERE status = 'error')::int AS errors
      FROM agent_tasks
      WHERE tenant_id = ${tid} AND started_at > now() - interval '24 hours'`,
    s`SELECT count(*)::int AS c FROM agent_tasks
      WHERE tenant_id = ${tid} AND status = 'running' AND started_at < now() - interval '12 minutes'`,
    s`SELECT id, name, last_error FROM cron_jobs
      WHERE tenant_id = ${tid} AND enabled = true
        AND last_status IN ('error', 'failed', 'timeout')`,
    s`SELECT to_char(date_trunc('day', started_at), 'YYYY-MM-DD') AS day,
             count(*)::int AS total,
             count(*) FILTER (WHERE status = 'error')::int AS errors
      FROM agent_tasks
      WHERE tenant_id = ${tid} AND started_at > now() - interval '14 days'
      GROUP BY 1`,
    // Infra liveness — run alongside the tenant queries (the SELECT 1 here would
    // have thrown the outer query anyway if the DB were down, but it normalizes
    // the signal into the payload and lets us surface an explicit alert).
    probeDb(),
    probeBlob(),
  ]);

  const total = Number(taskAgg[0]?.total ?? 0);
  const errors = Number(taskAgg[0]?.errors ?? 0);
  const stuck = Number(stuckRows[0]?.c ?? 0);
  const errorRate = total > 0 ? errors / total : 0;

  const alerts: HealthAlert[] = [];
  let score = 100;

  // 1) agent run failures over the last 24h
  if (errors > 0) {
    score -= Math.round(errorRate * 40);
    alerts.push({
      id: 'agent-errors',
      severity: errorRate >= 0.5 ? 'critical' : 'warning',
      title: `${errors}/${total} agent runs failed (24h)`,
      detail: `${Math.round(errorRate * 100)}% error rate`,
      href: '/tasks',
    });
  }

  // 2) tasks stuck past the serverless ceiling
  if (stuck > 0) {
    score -= Math.min(20, stuck * 10);
    alerts.push({
      id: 'stuck-tasks',
      severity: 'critical',
      title: `${stuck} agent task${stuck > 1 ? 's' : ''} stuck`,
      detail: 'Running past the 300s limit — likely orphaned',
      href: '/tasks',
    });
  }

  // 3) cron jobs whose last run failed
  const failedCrons = cronRows as unknown as Array<{ id: string; name: string | null; last_error: string | null }>;
  if (failedCrons.length) {
    score -= Math.min(30, failedCrons.length * 10);
    for (const c of failedCrons.slice(0, 4)) {
      alerts.push({
        id: `cron-${c.id}`,
        severity: 'warning',
        title: `Cron "${c.name || c.id}" failed`,
        detail: c.last_error ? c.last_error.slice(0, 120) : undefined,
        href: '/cron',
      });
    }
  }

  // 4) integrations set up but no longer connected (defensive — skip if Nango
  //    isn't configured on this env, which is normal in local dev).
  try {
    const providers = await listProviderStatus();
    const broken = providers.filter((p) => p.available && !p.connected);
    if (broken.length) {
      score -= Math.min(15, broken.length * 5);
      alerts.push({
        id: 'integrations',
        severity: 'warning',
        title: `${broken.length} integration${broken.length > 1 ? 's' : ''} disconnected`,
        detail: broken.map((p) => p.label).join(', '),
        href: '/connections',
      });
    }
  } catch { /* nango not configured — ignore */ }

  // 5) infra liveness — blob store unreachable while configured is a real outage
  //    (renders can't be persisted). DB-down doesn't get an alert here because the
  //    tenant queries above would already have thrown into the SAFE fallback.
  if (blobState === 'down') {
    score -= 15;
    alerts.push({
      id: 'blob-store',
      severity: 'warning',
      title: 'Blob storage unreachable',
      detail: 'Vercel Blob is configured but not responding — video/render persistence will fail',
      href: '/connections',
    });
  }

  score = Math.max(0, Math.min(100, score));
  const status: HealthPayload['status'] = score >= 90 ? 'healthy' : score >= 60 ? 'degraded' : 'down';

  // 14-day daily success-rate trend; days with no runs read as 100 (nothing broke).
  const byDay = new Map<string, number>();
  for (const r of trendRows as unknown as Array<{ day: string; total: number; errors: number }>) {
    const t = Number(r.total), e = Number(r.errors);
    byDay.set(r.day, t > 0 ? Math.round((1 - e / t) * 100) : 100);
  }
  const trend: number[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - i);
    const key = d.toISOString().slice(0, 10);
    trend.push(byDay.get(key) ?? 100);
  }

  return { score, status, alerts, trend, activity24h: total, db: dbState, blob: blobState, checkedAt: new Date().toISOString() };
}
