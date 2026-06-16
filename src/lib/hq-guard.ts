import { NextResponse } from 'next/server';
import { tenantId, DEFAULT_TENANT_ID } from './tenant';

// KeyWatch / Issues / Fixer is an HQ-ONLY operations surface: it watches runtime
// errors and can open GitHub PRs against the product repo. It must never be
// reachable by client workspaces. Gate every issues API route + the page + nav
// entry on this. Call AFTER enterTenant(await resolveTenant()).

/** True only for the platform's own HQ workspace. */
export function isHqTenant(): boolean {
  return tenantId() === DEFAULT_TENANT_ID;
}

/** Returns a 403 response for non-HQ tenants, or null to proceed. */
export function requireHq(): NextResponse | null {
  return isHqTenant() ? null : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
}
