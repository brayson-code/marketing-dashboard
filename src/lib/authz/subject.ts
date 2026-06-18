// getSubject() — the SINGLE cached subject lookup (ADR §3 SUBJECT, §10 perf) plus
// the sole role-name bridge (ADR §4.6).
//
// One indexed query per request: SELECT role, preferences, grants FROM
// workspace_members WHERE workspace_id = tenantId() AND user_id = currentUserId().
// Memoized per-request via a WeakMap keyed on the ALS store object, so there is no
// cross-request poisoning, no TTL surface, and the cache is GC'd with the request.
//
// This same lookup is the KILL SWITCH (session/membership revocation): if a member
// was removed, the row is gone → getSubject() returns the least-privilege subject
// (role 'va', isMember:false) and isActiveMember() is false. Callers that need to
// drop a removed member mid-session consult isActiveMember() — one cached read, no
// extra query.

import { sql } from '@/lib/db/client';
import {
  tenantId,
  currentUserId,
  getStore,
  DEFAULT_TENANT_ID,
  type TenantContext,
} from '@/lib/tenant';
import type { Role } from '@/lib/rbac';
import type { Subject, WorkspaceRole } from './types';

// owner -> admin, member -> editor, va -> viewer. THE sole bridge (ADR §4.6). Anyone
// needing rbac.ts capabilities calls roleHasCapability(ROLE_TO_RBAC[s.role], cap).
// NOTE: the VA is highly empowered operationally (see the policy modules) — this
// bridge is ONLY for the rbac.ts capability matrix, not for the ABAC policy decisions.
export const ROLE_TO_RBAC: Record<WorkspaceRole, Role> = {
  owner: 'admin',
  member: 'editor',
  va: 'viewer',
} as const;

// The resolved subject carries an extra `isMember` flag (not part of the ABAC
// Subject shape) so the kill-switch can distinguish "authenticated but not a member
// of this tenant" (fail-closed least privilege) from a real member.
export interface ResolvedSubject extends Subject {
  /** True only when a live workspace_members row exists for (tenant, user). */
  isMember: boolean;
}

interface MemberRow {
  role: WorkspaceRole;
  preferences: Record<string, unknown> | null;
  grants: Record<string, unknown> | null;
}

// Per-request memoization. Keyed on the ALS store OBJECT identity (stable for the
// life of one request, unique per request) → no cross-request leakage, auto-GC.
const cache = new WeakMap<TenantContext, ResolvedSubject>();

async function loadMemberRow(tid: string, uid: string): Promise<MemberRow | null> {
  try {
    const rows = (await sql()`
      SELECT role, preferences, grants
      FROM public.workspace_members
      WHERE workspace_id = ${tid} AND user_id = ${uid}
      LIMIT 1
    `) as unknown as MemberRow[];
    return rows[0] ?? null;
  } catch {
    // Fail closed: a lookup failure must not silently grant a role.
    return null;
  }
}

/**
 * Resolve the acting subject for the current request.
 *
 * - Reads tenantId() + currentUserId() from the ALS store (populated by
 *   resolveTenant()/enterTenant()). It does NOT re-resolve tenancy.
 * - Runs exactly ONE indexed workspace_members lookup, memoized per request.
 * - `opts.live === true` bypasses the memo (sensitive actions force a fresh read;
 *   ADR §5 staleness contract — moot day-one since there's no JWT role yet, but the
 *   param is wired now).
 * - If currentUserId() is null (cron/system — which skip the guard) OR no membership
 *   row exists, returns a least-privilege subject (role 'va', isMember:false). This
 *   is the fail-closed posture AND the kill-switch for removed members.
 */
export async function getSubject(opts?: { live?: boolean }): Promise<ResolvedSubject> {
  const tid = tenantId();
  const uid = currentUserId();
  const isHq = tid === DEFAULT_TENANT_ID;
  const store = getStore();

  // Memo hit (only when we have a real ALS store + not forcing a live read).
  if (!opts?.live && store) {
    const hit = cache.get(store);
    if (hit) return hit;
  }

  // No user subject (cron/system). These paths skip authorize() entirely (ADR §12.7),
  // but if they ever reach getSubject() we return least privilege, not owner.
  if (!uid) {
    const subject: ResolvedSubject = {
      userId: '',
      tenantId: tid,
      role: 'va',
      isHq,
      attrs: {},
      isMember: false,
    };
    return subject;
  }

  // TODO Phase 3: read the x-role header first (JWT app_metadata cache, set+stripped
  // by the middleware like x-tenant-id), fall back to this query. ADR §5 — day one
  // there is NO JWT role change, so this query is the source of truth.
  const row = await loadMemberRow(tid, uid);

  const subject: ResolvedSubject = row
    ? {
        userId: uid,
        tenantId: tid,
        role: row.role,
        isHq,
        // Merge UI preferences (0034) + authz grants (0047) into subject.attrs.
        // grants win on key collision so authz overrides aren't shadowed by UI prefs.
        attrs: { ...(row.preferences ?? {}), ...(row.grants ?? {}) },
        isMember: true,
      }
    : {
        // Authenticated but NOT a member of the active tenant (or removed) →
        // least-privilege, fail-closed. Any on-mode write policy will deny.
        userId: uid,
        tenantId: tid,
        role: 'va',
        isHq,
        attrs: {},
        isMember: false,
      };

  if (!opts?.live && store) cache.set(store, subject);
  return subject;
}

/**
 * Synchronous peek at the already-memoized subject for THIS request, or null if it
 * hasn't been loaded yet (no I/O — never triggers a query). Used by the synchronous
 * api-auth.ts bridge so it can apply the coarse role gate when the subject is already
 * in hand, and fail-open (non-breaking) when it isn't. Honors AUTHZ_ENFORCE off via
 * the caller, not here.
 */
export function peekSubject(): ResolvedSubject | null {
  const store = getStore();
  if (!store) return null;
  return cache.get(store) ?? null;
}

/**
 * Eagerly prime the per-request subject cache. Cheap no-op if already cached. Call
 * once near the top of a handler (after enterTenant) so the synchronous api-auth.ts
 * helpers and the kill-switch have a hot subject. Safe to skip — getSubject() and the
 * guards still work without it.
 */
export async function primeSubject(): Promise<void> {
  await getSubject();
}

/**
 * Kill-switch helper: true only when the current user is a LIVE member of the active
 * tenant. A removed member resolves to isMember:false on their next request — drop
 * them (force re-auth / logout) without an extra query. Cheap: reuses the cached
 * subject. Cron/system paths (no user) are NOT members and return false here.
 */
export async function isActiveMember(): Promise<boolean> {
  const s = await getSubject();
  return s.isMember;
}
