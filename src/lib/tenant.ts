// Request-scoped tenant context (multi-tenant foundation).
//
// The backend connects as the postgres role, which BYPASSES RLS — so the ONLY
// thing isolating one workspace's data from another is that every query scopes to
// the right tenant_id. Historically that was the constant DEFAULT_TENANT_ID
// (single-tenant). To go multi-tenant WITHOUT threading a tenantId argument through
// hundreds of call sites, we stash the active tenant in an AsyncLocalStorage that
// is set once per request (see withTenant) and read by tenantId() inside queries.
//
// MIGRATION STATUS: new code (onboarding, connections, and anything workspace-aware)
// uses tenantId(). Legacy libs still import DEFAULT_TENANT_ID directly; flipping them
// to tenantId() is the verification-gated step before real client data goes live.

import { AsyncLocalStorage } from 'node:async_hooks';

export interface TenantContext {
  tenantId: string;
  userId: string | null;
}

const storage = new AsyncLocalStorage<TenantContext>();

// Fallback tenant when no request context is set (cron/system jobs, legacy paths).
// Same value as the old single-tenant constant so nothing breaks during migration.
export const DEFAULT_TENANT_ID =
  process.env.DEFAULT_TENANT_ID ?? 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';

// Sentinel for an AUTHENTICATED user who has NO assigned workspace (no JWT
// tenant claim). It's the nil UUID — a valid uuid that matches no real tenant —
// so every tenant-scoped query returns empty (fail-closed) instead of leaking the
// system-default (HQ) tenant to an unprovisioned user. Distinct from DEFAULT_TENANT_ID,
// which is the legitimate fallback for system/cron paths that have no user at all.
export const NO_TENANT_ID = '00000000-0000-0000-0000-000000000000';

/** Run `fn` with an active tenant context (everything inside sees tenantId()). */
export function runWithTenant<T>(ctx: TenantContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/**
 * Set the tenant context for the REMAINDER of the current async execution (this
 * request's handler + everything it awaits) without wrapping a callback. Each
 * request runs in its own async context, so this does not leak across concurrent
 * requests. Call once at the top of a route handler via resolveTenant().
 */
export function enterTenant(ctx: TenantContext): void {
  storage.enterWith(ctx);
}

/** The active tenant_id for this request, or the system default outside a request. */
export function tenantId(): string {
  return storage.getStore()?.tenantId ?? DEFAULT_TENANT_ID;
}

/** The authenticated user id for this request, if resolved. */
export function currentUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

/** True when we're inside an explicit tenant context (vs. the system fallback). */
export function hasTenantContext(): boolean {
  return storage.getStore() != null;
}

/**
 * The raw per-request ALS store object (or undefined outside a request).
 * Exposed ONLY as a stable per-request identity for request-scoped memoization
 * (e.g. the ABAC subject cache keys a WeakMap on this object reference, so the
 * cache cannot poison across concurrent requests and is collected with the store).
 * Do NOT use it to read tenantId/userId — use tenantId()/currentUserId() for that.
 */
export function getStore(): TenantContext | undefined {
  return storage.getStore();
}

/** True when the active request resolves to a real workspace (not the no-workspace
 *  sentinel). An authenticated user without an assigned workspace resolves to
 *  NO_TENANT_ID; system/cron paths resolve to DEFAULT_TENANT_ID, which IS a real one. */
export function hasWorkspace(): boolean {
  return tenantId() !== NO_TENANT_ID;
}
