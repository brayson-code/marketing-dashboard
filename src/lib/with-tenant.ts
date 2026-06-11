// Per-request tenant resolution. Use at the top of a route handler as:
//
//     enterTenant(await resolveTenant());
//
// The Next.js middleware (src/proxy.ts — Next 16's "proxy" convention) validates the
// user, STRIPS any client-supplied x-tenant-id / x-user-id headers, and reinjects
// them from the verified JWT claim. So we trust those headers HERE only because the
// middleware already sanitized them — a fast path that avoids a second Auth
// round-trip per request.
//
// FAIL-CLOSED: an authenticated user with NO tenant claim resolves to NO_TENANT_ID
// (the nil-uuid sentinel → tenant-scoped queries return empty), NEVER the
// system-default (HQ). An auth error also fails closed. DEFAULT_TENANT_ID is used
// only for genuinely session-less public/system paths (which the middleware lets
// through, e.g. error reporting), preserving their existing behavior.

import { headers } from 'next/headers';
import { createClient } from './supabase/server';
import { DEFAULT_TENANT_ID, NO_TENANT_ID, type TenantContext } from './tenant';

// Re-exported so call sites import both from one place: enterTenant(await resolveTenant()).
export { enterTenant } from './tenant';

export async function resolveTenant(): Promise<TenantContext> {
  try {
    const h = await headers();
    const headerTenant = h.get('x-tenant-id');
    const headerUser = h.get('x-user-id');
    // Fast path: trust the middleware-sanitized headers.
    if (headerTenant) return { tenantId: headerTenant, userId: headerUser };
    // Authenticated user but no tenant claim → no assigned workspace. Fail closed.
    if (headerUser) return { tenantId: NO_TENANT_ID, userId: headerUser };

    // No middleware headers → a public/bypassed path. Validate the session directly.
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    // Session-less system/public path → keep the system default (unchanged).
    if (!user) return { tenantId: DEFAULT_TENANT_ID, userId: null };
    const claim = (user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
    // Authenticated but unprovisioned → fail closed to the no-workspace sentinel.
    return { tenantId: typeof claim === 'string' && claim ? claim : NO_TENANT_ID, userId: user.id };
  } catch {
    // Any failure (headers unavailable, getUser threw) → fail closed, never HQ.
    return { tenantId: NO_TENANT_ID, userId: null };
  }
}
