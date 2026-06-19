// Hard role gates for the audit's named OWNER-ONLY / sensitive routes.
//
// These are the gates that run a REAL 403 *independent* of AUTHZ_ENFORCE — the
// audit's named exploits (invite, autonomy-level flip, secret rotation) and the VA
// matrix's OWNER-ONLY set. They are NOT the flag-gated authorize()/requireAuthorized
// shadow layer; they are the proven `isTenantOwner()` pattern from
// src/app/api/tenant/export/route.ts + src/app/api/clients/route.ts, centralized so
// every sensitive route reads the role one way.
//
// WHY hard-gate (not flag-gated) is still non-breaking:
//   Every policy/gate here is default-ALLOW-for-owner. 100% of production today is
//   single-owner (the owner is the only member), so the owner always passes and
//   behavior is IDENTICAL to today. The only requests these can newly block belong
//   to a *second* member/va — which no production workspace has yet. The
//   single-owner invariant (prompt invariant #2) holds in every AUTHZ_ENFORCE mode.
//
// SAFETY: these helpers issue ONE read-only, tenant-scoped, PK-covered query
// (WHERE workspace_id = ${tenantId()} AND user_id = ${currentUserId()}). They never
// remove or weaken a tenant_id filter and can only ever DENY (return false / a 403).
// They compose monotonically with tenant isolation + RLS.

import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';
import { emitSecurityEvent } from '@/lib/security-events';
import type { WorkspaceRole } from './types';

/**
 * The current user's role in the ACTIVE tenant, or null when there is no user
 * (cron/system) or no membership row (authenticated-but-not-a-member → fail-closed).
 * One indexed, tenant-scoped read. Mirrors getSubject()'s role query but is a
 * standalone read so the hard gates do not depend on the (flag-aware) ABAC subject
 * cache.
 */
export async function getMemberRole(): Promise<WorkspaceRole | null> {
  const uid = currentUserId();
  if (!uid) return null;
  try {
    const rows = (await sql()`
      SELECT role FROM public.workspace_members
      WHERE workspace_id = ${tenantId()} AND user_id = ${uid}
      LIMIT 1
    `) as unknown as Array<{ role: WorkspaceRole }>;
    return rows[0]?.role ?? null;
  } catch {
    // Fail closed: a lookup failure must never be read as "owner".
    return null;
  }
}

/** True only when the current user is the OWNER of the active workspace. */
export async function isTenantOwner(): Promise<boolean> {
  return (await getMemberRole()) === 'owner';
}

const FORBIDDEN_OWNER = NextResponse.json(
  { error: 'Forbidden', reason: 'owner_only' },
  { status: 403 },
);

/**
 * Owner-only hard gate. Returns a 403 NextResponse to short-circuit the handler, or
 * null to proceed. Use as: `const gate = await requireOwner(); if (gate) return gate;`.
 * Independent of AUTHZ_ENFORCE — this is one of the audit's named OWNER-ONLY routes.
 */
export async function requireOwner(): Promise<NextResponse | null> {
  const role = await getMemberRole();
  if (role === 'owner') return null;
  // Fire-and-forget: do NOT await — the hard gate must stay synchronous-fast. The emit
  // is best-effort (never throws) and tenant-scoped via emitSecurityEvent's defaults.
  void emitSecurityEvent({
    type: 'owner_gate_deny',
    severity: 'warning',
    detail: { gate: 'requireOwner', role: role ?? 'none' },
  });
  return FORBIDDEN_OWNER;
}

/**
 * Owner-OR-member hard gate (VA blocked). Returns a 403 to short-circuit, or null to
 * proceed. Used for the autonomy-level flip (audit finding #1 / autonomy.ts policy:
 * owner+member may change the global autonomy level, VA may not).
 */
export async function requireOwnerOrMember(): Promise<NextResponse | null> {
  const role = await getMemberRole();
  if (role === 'owner' || role === 'member') return null;
  // Fire-and-forget (see requireOwner) — VA/non-member denial on an owner-or-member route.
  void emitSecurityEvent({
    type: 'owner_gate_deny',
    severity: 'warning',
    detail: { gate: 'requireOwnerOrMember', role: role ?? 'none' },
  });
  return NextResponse.json(
    { error: 'Forbidden', reason: 'autonomy_level_requires_owner_or_member' },
    { status: 403 },
  );
}
