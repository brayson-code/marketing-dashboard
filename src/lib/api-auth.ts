import { NextResponse } from 'next/server';
import { roleHasCapability, type Capability } from '@/lib/rbac';
import { authzMode } from '@/lib/authz/types';
import { peekSubject, ROLE_TO_RBAC } from '@/lib/authz/subject';
import { sql } from '@/lib/db/client';
import { tenantId, currentUserId } from '@/lib/tenant';

// Coarse, route-level authorization helpers. Authentication is enforced centrally by
// the Supabase session middleware (src/proxy.ts): any request reaching a handler has
// already passed auth (unauthenticated → 401 before the handler). These helpers add
// the INTRA-workspace role gate on top.
//
// MIGRATION (ADR-001, flag AUTHZ_ENFORCE):
//   - 'off' (DEFAULT): every helper returns null — IDENTICAL to the old no-ops. The
//     ~56 existing call sites (`const auth = requireApiAdmin(req); if (auth) return auth;`)
//     keep working unchanged; nothing breaks.
//   - 'shadow': a coarse role miss is LOGGED (best-effort, fire-and-forget) but still
//     ALLOWED — surfaces would-be denials against real traffic before any 403.
//   - 'on': a coarse role miss returns 403 — BUT ONLY when the per-request subject has
//     already been primed (peekSubject() is hot). These helpers are SYNCHRONOUS to
//     preserve every existing call site, so they cannot themselves load the subject;
//     when it isn't primed they FAIL OPEN (null) and log a gap, deferring real
//     enforcement to the per-handler async guards (requireAuthorized) which DO load it.
//     This is the deliberate "broad shadow-only" layer (ADR §4 / risks §11): it never
//     silently hard-blocks a request whose subject it couldn't read.
//
// They intentionally do NOT import the legacy `@/lib/auth` (better-sqlite3 +
// hermes-session cookie), which 401s every Supabase-authenticated user.

type RoleFloor = 'owner' | 'member' | 'va';
const ROLE_ORDER: Record<RoleFloor, number> = { va: 0, member: 1, owner: 2 };

function logShadow(reason: string, detail: Record<string, unknown>): void {
  // Fire-and-forget; never awaited from a sync helper, never throws into the caller.
  void (async () => {
    try {
      await sql()`
        INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
        VALUES (
          ${tenantId()}, ${currentUserId()}, ${null},
          ${'authz.shadow_deny'}, ${'api-auth'},
          ${JSON.stringify({ reason, ...detail })}
        )
      `;
    } catch {
      /* audit best-effort */
    }
  })();
}

function forbidden(reason: string): NextResponse {
  return NextResponse.json({ error: 'Forbidden', reason }, { status: 403 });
}

/**
 * Apply a coarse decision under the AUTHZ_ENFORCE mode. `ok` is the policy verdict;
 * `reason`/`detail` describe a miss. Returns a 403 only in 'on' mode with a real
 * (primed) subject; otherwise null (allow), logging in 'shadow'.
 */
function gate(ok: boolean, reason: string, detail: Record<string, unknown>): NextResponse | null {
  if (ok) return null;
  const mode = authzMode();
  if (mode === 'off') return null; // identical to the old no-op
  if (mode === 'shadow') {
    logShadow(reason, detail);
    return null;
  }
  // 'on'
  logShadow(reason, detail);
  return forbidden(reason);
}

/** Require any authenticated member of the active workspace. */
export function requireApiUser(_request: Request): NextResponse | null {
  if (authzMode() === 'off') return null;
  const s = peekSubject();
  if (!s) return null; // subject not primed → fail open (defer to per-handler guards)
  return gate(s.isMember, 'requires_member', { role: s.role, isMember: s.isMember });
}

/** Require owner (admin-equivalent) of the active workspace. */
export function requireApiAdmin(_request: Request): NextResponse | null {
  if (authzMode() === 'off') return null;
  const s = peekSubject();
  if (!s) return null;
  return gate(ROLE_ORDER[s.role] >= ROLE_ORDER.owner, 'requires_owner', { role: s.role });
}

/** Require owner or member (editor-equivalent) of the active workspace. */
export function requireApiEditor(_request: Request): NextResponse | null {
  if (authzMode() === 'off') return null;
  const s = peekSubject();
  if (!s) return null;
  return gate(ROLE_ORDER[s.role] >= ROLE_ORDER.member, 'requires_editor', { role: s.role });
}

/** Require a specific rbac.ts capability (via the owner→admin/member→editor/va→viewer bridge). */
export function requireApiCapability(
  _request: Request,
  capability: Capability,
): NextResponse | null {
  if (authzMode() === 'off') return null;
  const s = peekSubject();
  if (!s) return null;
  const has = roleHasCapability(ROLE_TO_RBAC[s.role], capability);
  return gate(has, 'missing_capability', { role: s.role, capability });
}
