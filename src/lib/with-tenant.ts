// Per-request tenant resolution (JWT-based). Call `await resolveTenant()` at the
// top of a route handler: it reads the active Supabase session (cookie, no network
// or DB lookup), pulls `tenant_id` from the user's JWT app_metadata, and sets the
// request's tenant context so every tenantId() inside the handler scopes to THAT
// workspace. Falls back to the system default (HQ) when there's no session or no
// tenant claim — so existing/legacy paths behave exactly as before.

import { createClient } from './supabase/server';
import { enterTenant, DEFAULT_TENANT_ID } from './tenant';

export async function resolveTenant(): Promise<{ tenantId: string; userId: string | null }> {
  let tenantId = DEFAULT_TENANT_ID;
  let userId: string | null = null;
  try {
    const supabase = await createClient();
    // getSession reads the JWT from the cookie locally (no network/DB round-trip);
    // the middleware already validated it on the way in.
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user;
    if (user) {
      userId = user.id;
      const claim = (user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
      if (typeof claim === 'string' && claim) tenantId = claim;
    }
  } catch {
    /* no session / unavailable → system default */
  }
  enterTenant({ tenantId, userId });
  return { tenantId, userId };
}
