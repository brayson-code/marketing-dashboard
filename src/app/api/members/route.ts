// /api/members — owner-facing TEAM management for the ACTIVE workspace.
//
//   GET                         → list members (role, email, grants)            [owner]
//   PATCH { user_id, role }     → change a member's role (owner|member|va)      [owner]
//   PATCH { user_id, grants }   → set a member's grantable capabilities         [owner]
//   DELETE { user_id }          → remove a member (+ revoke their sessions)     [owner]
//
// ALL operations are OWNER-ONLY via the hard, flag-independent requireOwner() gate
// (the audit's named member-management OWNER-ONLY set; mirrors policies/members.ts).
// Non-owners get a real 403 and an owner_gate_deny security event — independent of
// AUTHZ_ENFORCE. Single-owner prod is unaffected (the owner always passes).
//
// Every mutation writes an audit_log row (actor_id = currentUserId()) — same direct
// pattern as /api/invite — and is fully tenant-scoped (every query in members.ts
// filters workspace_id = ${tenantId()}). Last-owner protection (wouldOrphanWorkspace)
// refuses to demote/remove the final owner with a 409.
//
// Sibling routes: /api/invite (add a teammate), /api/approvals/pending (owner step-up).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { requireOwner } from '@/lib/authz';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  listWorkspaceMembers,
  countOwners,
  getMemberRoleFor,
  wouldOrphanWorkspace,
  changeMemberRole,
  setMemberGrants,
  deleteMemberRow,
  revokeUserSessions,
  sanitizeGrants,
  isWorkspaceRole,
  GRANTABLE_CAPABILITIES,
} from '@/lib/members';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** Direct, non-anonymous audit write (actor_id = the acting owner). Best-effort. */
async function audit(action: string, target: string | null, detail: Record<string, unknown>) {
  try {
    await sql()`
      INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
      VALUES (
        ${tenantId()}, ${currentUserId()}, ${null},
        ${action}, ${target}, ${JSON.stringify(detail)}
      )
    `;
  } catch {
    // Audit is best-effort; never block a member mutation on a log failure.
  }
}

/**
 * Build a userId → email resolver from the Supabase admin user list. Best-effort: if
 * the admin client isn't configured (no service-role key) or the lookup fails, every
 * email resolves to null and the UI shows the user id instead. Never throws.
 */
async function buildEmailResolver(): Promise<(userId: string) => string | null> {
  const map = new Map<string, string>();
  try {
    const admin = supabaseAdmin();
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) break;
      for (const u of data.users) if (u.email) map.set(u.id, u.email);
      if (data.users.length < 1000) break;
    }
  } catch {
    // No admin client / not configured → resolve everything to null.
  }
  return (userId: string) => map.get(userId) ?? null;
}

// GET — list members of the active workspace (owner-only).
export async function GET() {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwner();
  if (gate) return gate;

  try {
    const emailFor = await buildEmailResolver();
    const members = await listWorkspaceMembers(emailFor);
    return NextResponse.json({
      members,
      grantable: GRANTABLE_CAPABILITIES,
      total: members.length,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH — change a member's role OR set their grants (owner-only).
// Distinguished by which field is present: { user_id, role } vs { user_id, grants }.
export async function PATCH(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwner();
  if (gate) return gate;

  let body: { user_id?: string; role?: string; grants?: unknown };
  try {
    body = (await request.json()) as { user_id?: string; role?: string; grants?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = (body.user_id ?? '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  const currentRole = await getMemberRoleFor(userId);
  if (!currentRole) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 404 });
  }

  // ----- set grants -----
  if (body.grants !== undefined) {
    let grants: Record<string, true>;
    try {
      grants = sanitizeGrants(body.grants);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
    const updated = await setMemberGrants(userId, grants);
    if (!updated) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    await audit('member.set_grants', userId, { grants: Object.keys(grants) });
    return NextResponse.json({ ok: true, user_id: userId, grants });
  }

  // ----- change role -----
  if (body.role !== undefined) {
    if (!isWorkspaceRole(body.role)) {
      return NextResponse.json(
        { error: "role must be one of 'owner','member','va'" },
        { status: 400 },
      );
    }
    const nextRole = body.role;
    if (nextRole === currentRole) {
      return NextResponse.json({ ok: true, user_id: userId, role: nextRole, unchanged: true });
    }
    // Last-owner protection: never demote the final owner.
    if (wouldOrphanWorkspace(currentRole, nextRole, await countOwners())) {
      return NextResponse.json(
        { error: 'Cannot demote the last owner — promote another owner first', reason: 'last_owner' },
        { status: 409 },
      );
    }
    const updated = await changeMemberRole(userId, nextRole);
    if (!updated) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }
    await audit('member.change_role', userId, { from: currentRole, to: nextRole });
    return NextResponse.json({ ok: true, user_id: userId, role: nextRole });
  }

  return NextResponse.json({ error: 'Provide a role or grants to update' }, { status: 400 });
}

// DELETE — remove a member and revoke their Supabase sessions (owner-only).
export async function DELETE(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwner();
  if (gate) return gate;

  let body: { user_id?: string };
  try {
    body = (await request.json()) as { user_id?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const userId = (body.user_id ?? '').trim();
  if (!userId) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 });
  }

  // An owner removing themselves while they're the last owner would orphan the
  // workspace; block it the same way as a demotion.
  const currentRole = await getMemberRoleFor(userId);
  if (!currentRole) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 404 });
  }
  if (wouldOrphanWorkspace(currentRole, null, await countOwners())) {
    return NextResponse.json(
      { error: 'Cannot remove the last owner — promote another owner first', reason: 'last_owner' },
      { status: 409 },
    );
  }

  const removed = await deleteMemberRow(userId);
  if (!removed) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 });
  }

  // Revoke the removed user's sessions so a stale token can't keep acting. Best-effort
  // (the membership row is already gone; the /api/auth/me kill-switch is the backstop).
  const sessionsRevoked = await revokeUserSessions(userId);

  await audit('member.remove', userId, { role: currentRole, sessions_revoked: sessionsRevoked });
  return NextResponse.json({ ok: true, user_id: userId, sessions_revoked: sessionsRevoked });
}
