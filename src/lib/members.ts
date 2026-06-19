// members.ts — owner-facing TEAM/MEMBER management helpers for the active workspace.
//
// All DB helpers here are TENANT-SCOPED (every query filters
// `workspace_id = ${tenantId()}`), mirroring the rest of the backend. They are the
// thin data layer behind /api/members; the OWNER gate + audit live in the route
// (the route is where requireOwner() runs and where logAudit/emitSecurityEvent fire).
//
// SAFETY:
//  - No query here removes or weakens a tenant filter; these can only read/mutate rows
//    inside the active workspace.
//  - Last-owner protection (assertNotLastOwner) refuses to demote/remove the FINAL
//    owner so a workspace can never become owner-less (which would lock everyone out
//    of every owner-gated surface).
//  - removeMember ALSO revokes the removed user's Supabase refresh tokens (global
//    sign-out) so a removed VA/member cannot keep acting with a still-valid token
//    until it expires. This pairs with the AUTHZ_KILL_REMOVED_MEMBERS kill-switch in
//    /api/auth/me (which drops a stale access token on its next /me poll).

import { sql, tenantId, jsonb } from '@/lib/db/client';
import type { WorkspaceRole } from '@/lib/authz';

export const WORKSPACE_ROLES = ['owner', 'member', 'va'] as const;

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === 'owner' || value === 'member' || value === 'va';
}

// ---------------------------------------------------------------------------
// Grantable capabilities (ABAC subject.attrs grants — the workspace_members.grants
// jsonb from migration 0047). These are the capabilities an owner may DELEGATE to a
// member/VA. Deliberately the *grantable* subset only — NOT the owner-only set
// (billing, plan, workspace-delete, full-export, member management, secret rotation),
// which can never be granted away. A truthy value in `grants` flips the capability on
// in subject.attrs; getSubject() merges grants over preferences.
export const GRANTABLE_CAPABILITIES = [
  { key: 'content_write', label: 'Content create / edit' },
  { key: 'crm_write', label: 'CRM & sequences write' },
  { key: 'approve', label: 'Approve automations & drafts' },
  { key: 'publish', label: 'Publish content' },
  { key: 'view_audit', label: 'View the audit log' },
] as const;

export type GrantableCapability = (typeof GRANTABLE_CAPABILITIES)[number]['key'];

const GRANTABLE_KEYS: ReadonlySet<string> = new Set(
  GRANTABLE_CAPABILITIES.map((c) => c.key),
);

export function isGrantableCapability(key: unknown): key is GrantableCapability {
  return typeof key === 'string' && GRANTABLE_KEYS.has(key);
}

/**
 * Sanitize an owner-submitted grants object into the storable shape:
 *  - only known GRANTABLE keys survive (unknown / owner-only keys are dropped, so a
 *    crafted payload can't smuggle in an out-of-matrix capability),
 *  - every value is coerced to a boolean,
 *  - falsey entries are removed entirely so the stored jsonb stays minimal and
 *    `subject.attrs.<cap> === true` is the only truthy shape.
 * Returns a flat `Record<string, true>`. Throws on a non-object payload.
 */
export function sanitizeGrants(input: unknown): Record<string, true> {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('grants must be a flat object of capability → boolean');
  }
  const out: Record<string, true> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isGrantableCapability(key)) continue; // drop unknown / owner-only keys
    // Reject nested objects/arrays — grants must be flat scalars (ADR: flat attrs).
    if (value !== null && typeof value === 'object') {
      throw new Error(`grant value for ${key} must be a boolean`);
    }
    if (value === true || value === 'true' || value === 1) out[key] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
export interface MemberRecord {
  user_id: string;
  role: WorkspaceRole;
  email: string | null;
  grants: Record<string, boolean>;
  created_at: string | null;
}

interface MemberRow {
  user_id: string;
  role: WorkspaceRole;
  grants: Record<string, unknown> | null;
  created_at: string | null;
}

/**
 * List the active workspace's members with their role, grants, and (best-effort)
 * email. Email resolution uses the Supabase admin user list (no email column lives in
 * workspace_members) — passed in by the caller so this lib stays free of the admin
 * client import and is unit-testable. Unknown emails resolve to null.
 */
export async function listWorkspaceMembers(
  emailFor: (userId: string) => string | null,
): Promise<MemberRecord[]> {
  const rows = (await sql()`
    SELECT user_id, role, grants, created_at
    FROM public.workspace_members
    WHERE workspace_id = ${tenantId()}
    ORDER BY
      CASE role WHEN 'owner' THEN 0 WHEN 'member' THEN 1 ELSE 2 END,
      created_at ASC NULLS LAST
  `) as unknown as MemberRow[];

  return rows.map((r) => ({
    user_id: r.user_id,
    role: r.role,
    email: emailFor(r.user_id),
    grants: onlyGrantableBooleans(r.grants),
    created_at: r.created_at,
  }));
}

/** Project a stored grants jsonb down to the known grantable booleans for the UI. */
function onlyGrantableBooleans(grants: Record<string, unknown> | null): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const cap of GRANTABLE_CAPABILITIES) {
    out[cap.key] = grants?.[cap.key] === true;
  }
  return out;
}

/** Count owners in the active workspace (used for last-owner protection). */
export async function countOwners(): Promise<number> {
  const rows = (await sql()`
    SELECT count(*)::int AS n
    FROM public.workspace_members
    WHERE workspace_id = ${tenantId()} AND role = 'owner'
  `) as unknown as Array<{ n: number }>;
  return rows[0]?.n ?? 0;
}

/** A member's current role in the active workspace, or null if not a member. */
export async function getMemberRoleFor(userId: string): Promise<WorkspaceRole | null> {
  const rows = (await sql()`
    SELECT role FROM public.workspace_members
    WHERE workspace_id = ${tenantId()} AND user_id = ${userId}
    LIMIT 1
  `) as unknown as Array<{ role: WorkspaceRole }>;
  return rows[0]?.role ?? null;
}

/**
 * Pure last-owner guard. Given the target member's CURRENT role and the total owner
 * count, returns true when the requested change would strip the workspace of its last
 * owner (demoting the only owner, or removing the only owner). The route turns a true
 * here into a 409. Pure + exported so it is unit-testable without a DB.
 *
 * @param nextRole the role after the change, or null for removal.
 */
export function wouldOrphanWorkspace(
  currentRole: WorkspaceRole | null,
  nextRole: WorkspaceRole | null,
  ownerCount: number,
): boolean {
  // Only a change that takes an owner OUT of the owner set can orphan the workspace.
  if (currentRole !== 'owner') return false;
  const staysOwner = nextRole === 'owner';
  if (staysOwner) return false;
  // The target is the only owner → blocking this change keeps ≥1 owner.
  return ownerCount <= 1;
}

/** Change a member's role (tenant-scoped). Returns the number of rows updated. */
export async function changeMemberRole(userId: string, role: WorkspaceRole): Promise<number> {
  const rows = (await sql()`
    UPDATE public.workspace_members
    SET role = ${role}
    WHERE workspace_id = ${tenantId()} AND user_id = ${userId}
    RETURNING user_id
  `) as unknown as Array<{ user_id: string }>;
  return rows.length;
}

/** Set a member's grants jsonb (tenant-scoped). `grants` must be pre-sanitized. */
export async function setMemberGrants(
  userId: string,
  grants: Record<string, true>,
): Promise<number> {
  const rows = (await sql()`
    UPDATE public.workspace_members
    SET grants = ${jsonb(grants)}
    WHERE workspace_id = ${tenantId()} AND user_id = ${userId}
    RETURNING user_id
  `) as unknown as Array<{ user_id: string }>;
  return rows.length;
}

/** Delete a member row (tenant-scoped). Returns the number of rows removed. */
export async function deleteMemberRow(userId: string): Promise<number> {
  const rows = (await sql()`
    DELETE FROM public.workspace_members
    WHERE workspace_id = ${tenantId()} AND user_id = ${userId}
    RETURNING user_id
  `) as unknown as Array<{ user_id: string }>;
  return rows.length;
}

/**
 * Revoke ALL of a user's Supabase sessions (global refresh-token invalidation), so a
 * removed member cannot refresh their session. Best-effort: returns true on success,
 * false on any failure (the membership row is already gone either way, and the
 * /api/auth/me kill-switch is the belt-and-braces second line).
 *
 * WHY a raw GoTrue call and not admin.signOut(): in @supabase/auth-js the admin
 * `signOut(jwt, scope)` takes the USER'S JWT (which we don't hold for a removed
 * member). The server-side, by-user-id revocation is the GoTrue admin endpoint
 * `POST /admin/users/{id}/logout?scope=global`, authenticated with the service-role
 * key. We call it directly with the same env the admin client uses.
 */
export async function revokeUserSessions(userId: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false; // no-op when admin auth isn't configured
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/auth/v1/admin/users/${encodeURIComponent(userId)}/logout?scope=global`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}
