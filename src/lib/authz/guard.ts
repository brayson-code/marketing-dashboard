// Handler helpers — the ergonomic enforcement points (ADR §4.5, §11).
//
//   const gate = await requireAuthorized('rotate_secret', resource); if (gate) return gate;
//
// Mirrors the existing requireApi* convention (return a NextResponse to short-circuit,
// or null to proceed). Resolves the cached subject, calls authorize(), then applies
// the AUTHZ_ENFORCE mode:
//   - off    : authorize() already returned allow() → proceed (null). Never logs.
//   - shadow : on a deny, LOG 'authz.shadow_deny' then PROCEED (null). Surfaces real
//              policy denials against live traffic before any user sees a 403.
//   - on     : on a deny, LOG 'authz.deny' and return 403.
//
// The audit write here is self-contained (inserts actor_id = currentUserId() directly)
// so the guard is usable without depending on logAudit()'s legacy User-shaped actor.

import { NextResponse } from 'next/server';
import { sql } from '@/lib/db/client';
import { tenantId, currentUserId } from '@/lib/tenant';
import { authorize } from './authorize';
import { getSubject } from './subject';
import { authzMode, type Action, type Resource, type ResourceType, type Env } from './types';

interface ResourceInput {
  type: ResourceType;
  /** The row's tenant_id; defaults to the active tenant when not loaded from a row. */
  tenantId?: string;
  createdBy?: string | null;
  /** The loaded row (or request payload for create/list). */
  attrs?: Record<string, unknown>;
}

interface GuardOpts {
  /** Force a fresh subject read (sensitive actions opt out of any cache). */
  live?: boolean;
  /** Environment override; defaults to { now, via:'api' }. */
  env?: Partial<Env>;
}

async function auditAuthz(
  authzAction: 'authz.shadow_deny' | 'authz.deny',
  resourceType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    await sql()`
      INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
      VALUES (
        ${tenantId()}, ${currentUserId()}, ${null},
        ${authzAction}, ${resourceType}, ${JSON.stringify(detail)}
      )
    `;
  } catch {
    // Never let an audit-write failure block (or falsely allow) the request.
  }
}

/**
 * Authorize `action` on `resource`. Returns a 403 NextResponse to short-circuit the
 * handler, or null to proceed. In 'off'/'shadow' it always returns null (non-breaking).
 */
export async function requireAuthorized(
  action: Action | string,
  resource: ResourceInput,
  opts?: GuardOpts,
): Promise<NextResponse | null> {
  const subject = await getSubject({ live: opts?.live });
  const env: Env = { now: new Date(), via: 'api', ...opts?.env };
  const r: Resource = {
    type: resource.type,
    tenantId: resource.tenantId ?? subject.tenantId,
    createdBy: resource.createdBy ?? null,
    attrs: resource.attrs ?? {},
  };

  const decision = authorize(subject, action, r, env);
  if (decision.allow) return null;

  const mode = authzMode();
  if (mode === 'shadow') {
    await auditAuthz('authz.shadow_deny', resource.type, { reason: decision.reason, action });
    return null; // log, then proceed — behaves exactly as today
  }
  if (mode === 'on') {
    await auditAuthz('authz.deny', resource.type, { reason: decision.reason, action });
    return NextResponse.json({ error: 'Forbidden', reason: decision.reason }, { status: 403 });
  }
  // 'off' never reaches here (authorize() returned allow()).
  return null;
}

/**
 * Coarse role gate used by the api-auth.ts bridge — no resource row, the resource is
 * the request itself (type 'tenant'). Returns the same short-circuit/null contract.
 * Used for the broad shadow-only layer; never hard-blocks in off/shadow.
 */
export async function requireRole(
  minimum: 'owner' | 'member' | 'va',
  opts?: GuardOpts,
): Promise<NextResponse | null> {
  const subject = await getSubject({ live: opts?.live });
  const order: Record<'owner' | 'member' | 'va', number> = { va: 0, member: 1, owner: 2 };
  const ok = order[subject.role] >= order[minimum];
  if (ok) return null;

  const mode = authzMode();
  if (mode === 'off') return null;
  if (mode === 'shadow') {
    await auditAuthz('authz.shadow_deny', 'role', { reason: `requires_${minimum}`, role: subject.role });
    return null;
  }
  await auditAuthz('authz.deny', 'role', { reason: `requires_${minimum}`, role: subject.role });
  return NextResponse.json({ error: 'Forbidden', reason: `requires_${minimum}` }, { status: 403 });
}

/**
 * withAuthz() — thin HOF for the load-then-check pattern (ADR §11 mitigation).
 * Optional; not required on every route. Wraps a handler so a denial short-circuits
 * before the body runs. The resource is resolved lazily so the handler can pre-load.
 */
export function withAuthz<Args extends unknown[]>(
  action: Action | string,
  resolveResource: (...args: Args) => ResourceInput | Promise<ResourceInput>,
  handler: (...args: Args) => Promise<NextResponse> | NextResponse,
  opts?: GuardOpts,
): (...args: Args) => Promise<NextResponse> {
  return async (...args: Args): Promise<NextResponse> => {
    const resource = await resolveResource(...args);
    const gate = await requireAuthorized(action, resource, opts);
    if (gate) return gate;
    return handler(...args);
  };
}
