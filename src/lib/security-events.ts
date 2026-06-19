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
  try {
    // A system/anon event (no real workspace — e.g. an anonymous auth_fail, or a
    // webhook limiter tripping pre-tenant) stores tenant_id = NULL rather than the
    // NO_TENANT_ID sentinel, which isn't a real tenants row and would FK-fail. NULL
    // rows are HQ-console-only (RLS excludes NULL from tenant-scoped reads).
    const resolved = input.tenantId ?? tenantId();
    const tid = resolved === NO_TENANT_ID ? null : resolved;
    const actor = input.actorUserId === undefined ? currentUserId() : input.actorUserId;
    const detail = input.detail ? JSON.stringify(input.detail) : null;

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

  // Critical events alert the HQ owner. Lazy dynamic import keeps this module a leaf and
  // degrades to a no-op if the alerts module fails — alerting must never break a request.
  // The events -> alerts edge is ONE-WAY and lazy (security-alerts.ts only `import type`s
  // back), so there is no import cycle and no eager dependency at module-init time. A
  // literal specifier (vs. the earlier indirect `const spec`) lets webpack resolve the
  // chunk statically — same runtime behavior, no "Critical dependency" build warning.
  if (input.severity === 'critical') {
    try {
      const mod = (await import('./security-alerts').catch(() => null)) as
        | AlertModule
        | null;
      if (mod?.maybeAlert) await mod.maybeAlert(input);
    } catch {
      // Alerting is best-effort; swallow.
    }
  }
}
