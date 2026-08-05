import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { tenantId, DEFAULT_TENANT_ID, NO_TENANT_ID, hasWorkspace } from '@/lib/tenant';
import { getSubject, ROLE_TO_RBAC } from '@/lib/authz';
import { redeemPendingEntitlement } from '@/lib/stripe';
import { emitSecurityEvent } from '@/lib/security-events';
import { getEnabledViews } from '@/lib/command-center-views';

// Returns the current Supabase-authenticated user, with the REAL intra-workspace role
// (owner | member | va) read from workspace_members (via getSubject()). This lets the
// UI differentiate roles; the API routes still enforce access server-side regardless,
// so surfacing the role does NOT change access. No better-sqlite3.
export async function GET() {
  enterTenant(await resolveTenant());
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    // Unauthenticated hit on the session endpoint. Low-signal on its own (the app polls
    // /api/auth/me), but a burst from one source is escalated to an alert by the spike
    // detector. Fire-and-forget; actorUserId:null marks it anon/system.
    void emitSecurityEvent({ type: 'auth_fail', severity: 'info', actorUserId: null });
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

  // Real role from workspace_members (owner | member | va). When the user is
  // authenticated but not a member of the active tenant, getSubject() returns the
  // least-privilege 'va' (fail-closed) and the UI hides privileged surfaces.
  //
  // De-stub note: previously `role` was hardcoded 'admin' for everyone. We now derive
  // it from the DB. The existing UI is coded against the rbac.ts vocabulary
  // (admin|editor|viewer), so `role` keeps that shape via the ROLE_TO_RBAC bridge
  // (owner→admin, member→editor, va→viewer) — every current consumer keeps working
  // and a single-owner workspace is UNAFFECTED (owner→admin, exactly as before). The
  // raw workspace role is additionally exposed as `workspace_role` for new UI.
  const subject = await getSubject();
  const rbacRole = ROLE_TO_RBAC[subject.role];

  // KILL SWITCH (membership revocation). A removed member can still hold a valid JWT
  // with the old tenant claim until it expires. resolveTenant() trusts that claim
  // without re-confirming membership, so without this check a removed member keeps
  // (least-privilege) read access until token expiry. Here — using the ALREADY-cached
  // subject (zero extra query) — if the user resolved INTO a real, non-system tenant
  // but has NO live workspace_members row there (isMember === false), they were
  // removed (or hold a stale claim): drop them with 401 so the client logs them out.
  //
  // Gated OFF by default (AUTHZ_KILL_REMOVED_MEMBERS !== 'true') so behavior is
  // identical to today until explicitly enabled. Single-owner owners always have a
  // membership row (created at provisioning), so they NEVER trip this in any mode.
  const realTenant = tid !== DEFAULT_TENANT_ID && tid !== NO_TENANT_ID;
  if (
    process.env.AUTHZ_KILL_REMOVED_MEMBERS === 'true' &&
    realTenant &&
    !subject.isMember
  ) {
    // A user holding a valid session whose tenant claim points at a workspace they are
    // NO LONGER a member of — a removed member presenting a stale claim into a tenant
    // they don't belong to. This is the canonical cross-tenant attempt → critical, so the
    // HQ owner is paged (deduped). actorUserId defaults to currentUserId(); record only
    // the reason (no secrets). Fire-and-forget so the 401 returns immediately.
    void emitSecurityEvent({
      type: 'cross_tenant_attempt',
      severity: 'critical',
      detail: { reason: 'membership_revoked', tenant_id: tid },
    });
    const gone = NextResponse.json(
      { error: 'Membership revoked', code: 'membership_revoked' },
      { status: 401 },
    );
    gone.headers.set('Cache-Control', 'no-store');
    return gone;
  }

  const response = NextResponse.json({
    user: {
      id: user.id,
      username: user.email,
      email: user.email,
      role: rbacRole,
      workspace_role: subject.role,
    },
    has_workspace: hasWorkspace(),
    // Prep mode: an assistant placed before day one reads but cannot act. The
    // MIDDLEWARE enforces it (src/proxy.ts); this is surfaced only so the UI can say
    // WHY a write was refused instead of leaving them staring at a dead button.
    prep_until: (user.app_metadata as Record<string, unknown> | undefined)?.prep_until ?? null,
    // HQ-only surfaces (e.g. KeyWatch / Issues) use this to hide themselves from
    // client workspaces. The API routes enforce it server-side regardless.
    is_hq: tid === DEFAULT_TENANT_ID,
    // Feature flags surfaced to the client purely to hide/show UI; the routes
    // enforce them server-side regardless.
    movie_clips_enabled: process.env.MOVIE_CLIPS_ENABLED === 'true',
    supercut_enabled: process.env.SUPERCUT_ENABLED === 'true',
    // SalesOps (PIF AI Sales Co-Pilot re-host) — default off. Gates the nav item and
    // the page; the admin routes enforce it server-side regardless.
    salesops_enabled: process.env.SALESOPS_ENABLED === 'true',
    // Command Center Builder ("playground") — OPTIONAL onboarding surface where a VA
    // composes this workspace's nav and previews it before applying. Default off; gates
    // ONLY the nav item + the /playground page (the underlying /api/command-center/views
    // routes are always available to members). Mirrors salesops_enabled.
    playground_enabled: process.env.PLAYGROUND_ENABLED === 'true',
    // SalesOps Playbook Phase 2 (Reanalyze: evidence sources → change-set → apply) —
    // a sub-flag of SalesOps, default off. Gates ONLY the Reanalyze surface on the
    // SalesOps page; the /api/salesops-admin/{sources,reanalyze,changeset*} routes enforce
    // it server-side regardless.
    playbook_reanalyze_enabled: process.env.PLAYBOOK_REANALYZE === 'true',
    // Command Center enabled-views map (href → enabled?; missing key = on). The HQ
    // workspace IGNORES the map (operators see everything), so it gets {} = all-on;
    // client workspaces get their persisted map. SUBTRACTIVE ONLY — the nav still
    // applies HQ-only/flag/plan gating on top, so a client can never reveal a view
    // they otherwise can't see.
    command_center_views: tid === DEFAULT_TENANT_ID ? {} : await getEnabledViews(),
  });
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
