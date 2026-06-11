// Per-request tenant resolution. Use at the top of a route handler as:
//
//     enterTenant(await resolveTenant());
//
// Resolution order (each step is a real, isolated source — never an arbitrary tenant):
//   1. x-tenant-id header — the JWT tenant claim, set by the middleware (src/proxy.ts)
//      which strips any client-supplied value and reinjects it from the validated
//      session. Fast path, no extra work.
//   2. The authenticated user's workspace_members row — the SOURCE OF TRUTH. The JWT
//      claim is only a cache of this; a freshly-issued session (e.g. just after the
//      recovery/set-password flow) can briefly lack the claim, so we fall back to the
//      user's actual membership rather than failing the request.
//   3. NO_TENANT_ID — authenticated but no workspace at all (fail closed → empty data,
//      never HQ).
//   4. DEFAULT_TENANT_ID — only for genuinely session-less public/system paths.

import { headers } from 'next/headers';
import { createClient } from './supabase/server';
import { sql } from './db/client';
import { DEFAULT_TENANT_ID, NO_TENANT_ID, type TenantContext } from './tenant';

// Re-exported so call sites import both from one place: enterTenant(await resolveTenant()).
export { enterTenant } from './tenant';

/** The user's workspace from membership (source of truth). Oldest membership wins. */
async function workspaceForUser(userId: string): Promise<string | null> {
  try {
    const rows = (await sql()`
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
      LIMIT 1
    `) as unknown as Array<{ workspace_id: string }>;
    return rows[0]?.workspace_id ?? null;
  } catch {
    return null;
  }
}

export async function resolveTenant(): Promise<TenantContext> {
  try {
    const h = await headers();
    const headerTenant = h.get('x-tenant-id');
    const headerUser = h.get('x-user-id');

    // 1. Trusted, middleware-sanitized tenant claim.
    if (headerTenant) return { tenantId: headerTenant, userId: headerUser };

    // 2. Authenticated but no claim header → resolve from membership before failing.
    if (headerUser) {
      const ws = await workspaceForUser(headerUser);
      return { tenantId: ws ?? NO_TENANT_ID, userId: headerUser };
    }

    // No middleware headers → a public/bypassed path. Validate the session directly.
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const user = data.user;
    if (!user) return { tenantId: DEFAULT_TENANT_ID, userId: null }; // session-less system/public
    const claim = (user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
    if (typeof claim === 'string' && claim) return { tenantId: claim, userId: user.id };
    const ws = await workspaceForUser(user.id);
    return { tenantId: ws ?? NO_TENANT_ID, userId: user.id };
  } catch {
    // Any failure → fail closed, never HQ.
    return { tenantId: NO_TENANT_ID, userId: null };
  }
}
