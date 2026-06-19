// HQ-only Security Console API — the operator's window onto the platform-wide
// security/ops event stream.
//
// This is the ONE intentional cross-tenant read in the product. It is gated by
// requireHq() (tenantId() === DEFAULT_TENANT_ID) BEFORE any cross-tenant query runs,
// exactly like the KeyWatch / Issues surface. A client workspace gets a 403 and never
// reaches the cross-tenant SELECTs. The browser/anon path can never reach this data at
// all (RLS on security_events isolates per tenant); this route runs server-side under
// the postgres role (which bypasses RLS) and is the deliberate, audited exception.
//
// Returns, ALL across tenants (HQ only):
//   - events:    the recent security_events stream (joined to tenant name), filterable
//                by type / severity (server-side allow-listed) — the raw feed.
//   - detections: grouped counts by (type, severity) over 24h and 7d, plus the specific
//                "firing" signals the console highlights (cross_tenant_attempt = critical,
//                authz_deny spikes, off-hours secret access).
//   - pending:    open pending_approvals across tenants (the owner step-up backlog).
//   - health:     a compact platform health roll-up derived from the same signals the
//                per-tenant /api/health uses (agent errors, stuck tasks, failed crons).
//
// Read-only. No mutations. Tenant isolation is NOT weakened for any other surface —
// every cross-tenant statement below is reachable only after requireHq() has proven HQ.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireHq } from '@/lib/hq-guard';
import { sql } from '@/lib/db/client';
import type { SecurityEventType, SecuritySeverity } from '@/lib/security-events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Server-side allow-lists — a filter value not on these lists is ignored (no SQL ever
// receives an arbitrary client string for type/severity).
const EVENT_TYPES: SecurityEventType[] = [
  'authz_deny', 'owner_gate_deny', 'rate_limited', 'auth_fail',
  'cross_tenant_attempt', 'secret_step_up', 'pending_approval_created',
  'integration_secret_access',
];
const SEVERITIES: SecuritySeverity[] = ['info', 'warning', 'critical'];

interface ConsoleEvent {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  type: string;
  severity: string;
  actor_user_id: string | null;
  resource_ref: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

interface GroupCount { type: string; severity: string; count: number }
interface Detection {
  id: string;
  severity: SecuritySeverity;
  title: string;
  detail: string;
  count: number;
}
interface PendingRow {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  requested_by: string | null;
  action: string;
  resource_ref: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
  enterTenant(await resolveTenant());

  // HARD GATE — everything below is cross-tenant and only HQ may see it. This runs
  // before any cross-tenant query; a non-HQ tenant returns 403 here and reads nothing.
  const denied = requireHq();
  if (denied) return denied;

  const url = new URL(req.url);
  const typeParam = url.searchParams.get('type');
  const sevParam = url.searchParams.get('severity');
  const type = typeParam && EVENT_TYPES.includes(typeParam as SecurityEventType)
    ? (typeParam as SecurityEventType) : null;
  const severity = sevParam && SEVERITIES.includes(sevParam as SecuritySeverity)
    ? (sevParam as SecuritySeverity) : null;
  const limit = Math.min(500, Math.max(10, Number(url.searchParams.get('limit') ?? 200)));

  try {
    const s = sql();

    // ── 1) The event stream ───────────────────────────────────────────────────
    // INTENTIONAL cross-tenant read — HQ security console ONLY; reachable only
    // because requireHq() above already proved tenantId() === DEFAULT_TENANT_ID.
    // Optional type/severity filters are applied via allow-listed values (never raw).
    const events = (await s`
      SELECT e.id, e.tenant_id, t.name AS tenant_name, e.type, e.severity,
             e.actor_user_id, e.resource_ref, e.detail, e.created_at
      FROM public.security_events e
      LEFT JOIN public.tenants t ON t.id = e.tenant_id
      WHERE (${type}::text IS NULL OR e.type = ${type})
        AND (${severity}::text IS NULL OR e.severity = ${severity})
      ORDER BY e.created_at DESC
      LIMIT ${limit}
    `) as unknown as ConsoleEvent[];

    // ── 2) Grouped detection counts (24h / 7d) ────────────────────────────────
    // INTENTIONAL cross-tenant aggregation — HQ console only (gated above).
    const [grouped24hRaw, grouped7dRaw, crossTenantRaw, authzSpikeRaw, offHoursSecretRaw] =
      await Promise.all([
        s`SELECT type, severity, count(*)::int AS count
          FROM public.security_events
          WHERE created_at > now() - interval '24 hours'
          GROUP BY type, severity
          ORDER BY count DESC`,
        s`SELECT type, severity, count(*)::int AS count
          FROM public.security_events
          WHERE created_at > now() - interval '7 days'
          GROUP BY type, severity
          ORDER BY count DESC`,
        // Firing detection: any cross_tenant_attempt in the last 24h is critical.
        s`SELECT count(*)::int AS count, count(distinct tenant_id)::int AS tenants
          FROM public.security_events
          WHERE type = 'cross_tenant_attempt' AND created_at > now() - interval '24 hours'`,
        // Firing detection: a spike in authz denials in the last hour (>= 10).
        s`SELECT count(*)::int AS count, count(distinct tenant_id)::int AS tenants
          FROM public.security_events
          WHERE type IN ('authz_deny','owner_gate_deny') AND created_at > now() - interval '1 hour'`,
        // Firing detection: integration-secret access outside business hours (UTC 00–06).
        s`SELECT count(*)::int AS count, count(distinct tenant_id)::int AS tenants
          FROM public.security_events
          WHERE type = 'integration_secret_access'
            AND created_at > now() - interval '24 hours'
            AND extract(hour FROM created_at at time zone 'UTC') < 6`,
      ]);

    const grouped24h = grouped24hRaw as unknown as GroupCount[];
    const grouped7d = grouped7dRaw as unknown as GroupCount[];
    const crossTenant = crossTenantRaw as unknown as Array<{ count: number; tenants: number }>;
    const authzSpike = authzSpikeRaw as unknown as Array<{ count: number; tenants: number }>;
    const offHoursSecret = offHoursSecretRaw as unknown as Array<{ count: number; tenants: number }>;

    const detections: Detection[] = [];
    const ct = crossTenant[0]?.count ?? 0;
    if (ct > 0) {
      detections.push({
        id: 'cross-tenant',
        severity: 'critical',
        title: 'Cross-tenant access attempts',
        detail: `${ct} attempt${ct > 1 ? 's' : ''} across ${crossTenant[0]?.tenants ?? 0} tenant(s) in 24h`,
        count: ct,
      });
    }
    const az = authzSpike[0]?.count ?? 0;
    if (az >= 10) {
      detections.push({
        id: 'authz-spike',
        severity: 'warning',
        title: 'Authorization-denial spike',
        detail: `${az} denials in the last hour across ${authzSpike[0]?.tenants ?? 0} tenant(s)`,
        count: az,
      });
    }
    const oh = offHoursSecret[0]?.count ?? 0;
    if (oh > 0) {
      detections.push({
        id: 'off-hours-secret',
        severity: 'warning',
        title: 'Off-hours secret access',
        detail: `${oh} integration-secret access${oh > 1 ? 'es' : ''} (00:00–06:00 UTC) in 24h`,
        count: oh,
      });
    }

    // ── 3) Open pending approvals across tenants ──────────────────────────────
    // INTENTIONAL cross-tenant read — HQ console only (gated above).
    const pending = (await s`
      SELECT p.id, p.tenant_id, t.name AS tenant_name, p.requested_by,
             p.action, p.resource_ref, p.created_at
      FROM public.pending_approvals p
      LEFT JOIN public.tenants t ON t.id = p.tenant_id
      WHERE p.status = 'pending'
      ORDER BY p.created_at ASC
      LIMIT 100
    `) as unknown as PendingRow[];

    // ── 4) Platform health roll-up (cross-tenant; gated above) ────────────────
    // Mirrors the signals /api/health uses, aggregated platform-wide.
    const [taskAggRaw, stuckRowsRaw, cronRowsRaw] = await Promise.all([
      s`SELECT count(*)::int AS total,
               count(*) FILTER (WHERE status = 'error')::int AS errors
        FROM agent_tasks
        WHERE started_at > now() - interval '24 hours'`,
      s`SELECT count(*)::int AS c FROM agent_tasks
        WHERE status = 'running' AND started_at < now() - interval '12 minutes'`,
      s`SELECT count(*)::int AS c FROM cron_jobs
        WHERE enabled = true AND last_status IN ('error','failed','timeout')`,
    ]);

    const taskAgg = taskAggRaw as unknown as Array<{ total: number; errors: number }>;
    const stuckRows = stuckRowsRaw as unknown as Array<{ c: number }>;
    const cronRows = cronRowsRaw as unknown as Array<{ c: number }>;

    const total = Number(taskAgg[0]?.total ?? 0);
    const errors = Number(taskAgg[0]?.errors ?? 0);
    const errorRate = total > 0 ? errors / total : 0;
    let score = 100;
    if (errors > 0) score -= Math.round(errorRate * 40);
    const stuck = Number(stuckRows[0]?.c ?? 0);
    if (stuck > 0) score -= Math.min(20, stuck * 10);
    const failedCrons = Number(cronRows[0]?.c ?? 0);
    if (failedCrons > 0) score -= Math.min(30, failedCrons * 10);
    score = Math.max(0, Math.min(100, score));

    const health = {
      score,
      status: (score >= 90 ? 'healthy' : score >= 60 ? 'degraded' : 'down') as
        'healthy' | 'degraded' | 'down',
      runs24h: total,
      errors24h: errors,
      stuckTasks: stuck,
      failedCrons,
    };

    return NextResponse.json({
      events,
      detections,
      grouped: { last24h: grouped24h, last7d: grouped7d },
      pending: { rows: pending, total: pending.length },
      health,
      filters: { type, severity },
      checkedAt: new Date().toISOString(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
