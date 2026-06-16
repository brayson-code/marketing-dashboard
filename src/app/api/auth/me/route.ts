import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { tenantId, DEFAULT_TENANT_ID, NO_TENANT_ID, hasWorkspace } from '@/lib/tenant';
import { redeemPendingEntitlement } from '@/lib/stripe';

// Returns the current Supabase-authenticated user. V1 single-tenant: the owner
// is treated as 'admin' (full access). Replace `role` with the user's
// tenant_members.role when multi-tenant RBAC lands. No better-sqlite3.
export async function GET() {
  enterTenant(await resolveTenant());
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Redeem any plan a cold buyer paid for before they had an account. Best-effort:
  // a no-op (and zero rows) for everyone who hasn't a pending entitlement. Skip
  // when the tenant is the system default (HQ) — i.e. the JWT claim hasn't been
  // stamped yet — so we never consume the entitlement against the wrong tenant.
  const tid = tenantId();
  // Only redeem against a REAL, non-HQ tenant. NO_TENANT_ID (unprovisioned user) must
  // be excluded — otherwise the pending entitlement is marked consumed against the
  // nil-uuid (granting nobody) and the paid plan is lost forever.
  if (user.email && tid !== DEFAULT_TENANT_ID && tid !== NO_TENANT_ID) {
    try {
      await redeemPendingEntitlement(user.email, tid);
    } catch {
      /* never block auth on billing reconciliation */
    }
  }

  const response = NextResponse.json({
    user: { id: user.id, username: user.email, email: user.email, role: 'admin' },
    has_workspace: hasWorkspace(),
    // HQ-only surfaces (e.g. KeyWatch / Issues) use this to hide themselves from
    // client workspaces. The API routes enforce it server-side regardless.
    is_hq: tid === DEFAULT_TENANT_ID,
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
