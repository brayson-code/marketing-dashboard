// security-events.ts — the ops-facing security event stream (FOUNDATION; everyone imports).
//
// emitSecurityEvent() appends one tenant-scoped row to public.security_events (migration
// 0048) and, for critical-severity events, fires the alert path. It is a LEAF module:
// it imports only sql/tenantId/currentUserId — no authz, no alerts at module load (the
// alert module is lazy-imported) — so it can be safely imported from guard.ts,
// owner-gate.ts, pending-approvals.ts, rate-limited routes, etc. with zero cycle risk.
//
// CONTRACT (frozen — A/B/C/D code against this):
//  - Fire-and-forget friendly: it NEVER throws into the caller. Callers may `void` it.
//  - Tenant-scoped automatically: writes tenant_id = input.tenantId ?? tenantId(), and
//    actor_user_id = input.actorUserId ?? currentUserId(). It never removes or weakens a
//    tenant filter.
//  - `detail` MUST be pre-redacted by the caller: never pass a raw plaintext secret.
//  - On severity 'critical' it lazy-imports ./security-alerts and calls maybeAlert(...),
//    which dedupes + notifies the HQ owner. Callers do NOT call security-alerts directly.
//
// Distinct from audit_log: audit_log is the compliance/forensic trail (kept by
// audit.ts/guard.ts); security_events is the high-signal operations stream the HQ
// security console + alerts consume. Several call sites DUAL-WRITE both on purpose.

import { after } from 'next/server';
import { sql } from '@/lib/db/client';
import { tenantId, currentUserId, NO_TENANT_ID } from '@/lib/tenant';

export type SecurityEventType =
  | 'authz_deny'
  | 'owner_gate_deny'
  | 'rate_limited'
  | 'auth_fail'
  | 'cross_tenant_attempt'
  | 'secret_step_up'
  | 'pending_approval_created'
  | 'integration_secret_access';

export type SecuritySeverity = 'info' | 'warning' | 'critical';

export interface SecurityEventInput {
  type: SecurityEventType;
  severity: SecuritySeverity;
  /** JSON-serializable; never a raw secret. */
  detail?: Record<string, unknown>;
  /** Override the actor; defaults to currentUserId(). null = system/anon. */
  actorUserId?: string | null;
  /** Override tenant (HQ console writes are still the emitter's own tenant). Defaults tenantId(). */
  tenantId?: string;
  /** Resource the event concerns, e.g. provider key or route. */
  resourceRef?: string | null;
}

/**
 * security-alerts.ts (owned by Stream D) exposes this shape. We reference it only
 * structurally (via the dynamic import below) so this module does NOT have a static
 * dependency on that file — emit still type-checks and runs before security-alerts lands,
 * and there is no import cycle (events -> alerts is one-way, lazy).
 */
type AlertModule = {
  maybeAlert: (event: SecurityEventInput & { created_at?: string }) => Promise<void>;
};

/**
 * Append-only, tenant-scoped, best-effort. NEVER throws into the caller. Returns void.
 * On a critical-severity event, fires security-alerts (deduped) without blocking.
 */
export async function emitSecurityEvent(input: SecurityEventInput): Promise<void> {
  // Resolve tenant/actor NOW, in the LIVE request context — NOT inside the after()
  // callback below, where the AsyncLocalStorage tenant context may already be torn
  // down. A system/anon event (no real workspace — e.g. an anonymous auth_fail, or a
  // webhook limiter tripping pre-tenant) stores tenant_id = NULL rather than the
  // NO_TENANT_ID sentinel, which isn't a real tenants row and would FK-fail. NULL
  // rows are HQ-console-only (RLS excludes NULL from tenant-scoped reads).
  let resolved: string;
  try { resolved = input.tenantId ?? tenantId(); } catch { resolved = NO_TENANT_ID; }
  const tid = resolved === NO_TENANT_ID ? null : resolved;
  let actor: string | null;
  try { actor = input.actorUserId === undefined ? currentUserId() : input.actorUserId; }
  catch { actor = input.actorUserId ?? null; }
  const detail = input.detail ? JSON.stringify(input.detail) : null;

  const work = (async () => {
    try {
      await sql()`
        INSERT INTO public.security_events
          (tenant_id, type, severity, actor_user_id, resource_ref, detail)
        VALUES (
          ${tid}, ${input.type}, ${input.severity},
          ${actor ?? null}, ${input.resourceRef ?? null}, ${detail}
        )
      `;
    } catch {
      // Best-effort: an event-write failure must never block (or falsely allow) the caller.
    }
    // Critical events alert the HQ owner via a one-way lazy import (no cycle).
    if (input.severity === 'critical') {
      try {
        const mod = (await import('./security-alerts').catch(() => null)) as AlertModule | null;
        if (mod?.maybeAlert) await mod.maybeAlert(input);
      } catch {
        // Alerting is best-effort; swallow.
      }
    }
  })();

  // Persist reliably on serverless: callers fire-and-forget this, then the handler
  // returns and the function SUSPENDS — so an un-awaited INSERT would be lost (this
  // was a real bug: 429s emitted but 0 rows landed). after() keeps the function alive
  // past the response to flush the write without blocking it. Outside a request scope
  // (cron, scripts, tests) after() throws → just run it inline.
  try {
    after(work);
  } catch {
    await work;
  }
}
