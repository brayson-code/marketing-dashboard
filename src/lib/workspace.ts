// Workspace + membership accessors and the user→tenant resolver. A "workspace" IS
// a tenant (workspaces.id == tenant_id used across the app). This is the multi-tenant
// core: given an authenticated user, resolve their active workspace and run work
// inside that tenant context so every scoped query hits the right data.
//
// SAFETY: real isolation depends on (a) resolving the correct tenant here and
// (b) every query scoping to tenantId(). The app-wide flip of legacy queries from
// DEFAULT_TENANT_ID → tenantId() + an isolation test is the gate before a real
// client's data goes live (see src/lib/tenant.ts header).

import { sql, jsonb } from './db/client';
import { runWithTenant } from './tenant';

export type WorkspaceRole = 'owner' | 'member' | 'va';

export interface Workspace {
  id: string;
  name: string;
  onboarding_complete: boolean;
  business_profile: Record<string, unknown> | null;
}

export interface WorkspaceMembership extends Workspace {
  role: WorkspaceRole;
}

/** All workspaces a user belongs to (with their role), newest first. */
export async function workspacesForUser(userId: string): Promise<WorkspaceMembership[]> {
  const rows = (await sql()`
    SELECT w.id, w.name, w.onboarding_complete, w.business_profile, m.role
    FROM public.workspace_members m
    JOIN public.workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = ${userId}
    ORDER BY w.created_at DESC
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    onboarding_complete: !!r.onboarding_complete,
    business_profile: (r.business_profile as Record<string, unknown> | null) ?? null,
    role: r.role as WorkspaceRole,
  }));
}

/** The user's active workspace id (first membership), or null if they have none. */
export async function primaryWorkspaceId(userId: string): Promise<string | null> {
  const ws = await workspacesForUser(userId);
  return ws[0]?.id ?? null;
}

/** Create a workspace and make `ownerUserId` its owner. Returns the new tenant id. */
export async function createWorkspace(name: string, ownerUserId: string): Promise<string> {
  const rows = (await sql()`
    INSERT INTO public.workspaces (name) VALUES (${name}) RETURNING id
  `) as unknown as Array<{ id: string }>;
  const id = String(rows[0].id);
  await sql()`
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (${id}, ${ownerUserId}, 'owner')
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
  return id;
}

/** Get the user's workspace, creating a fresh one for them if they have none. */
export async function ensureWorkspaceForUser(userId: string, name = 'My Workspace'): Promise<string> {
  return (await primaryWorkspaceId(userId)) ?? (await createWorkspace(name, userId));
}

/** Persist onboarding result onto a workspace. */
export async function completeOnboarding(workspaceId: string, profile: Record<string, unknown>): Promise<void> {
  await sql()`
    UPDATE public.workspaces
    SET business_profile = ${jsonb(profile)}, onboarding_complete = true, updated_at = now()
    WHERE id = ${workspaceId}
  `;
}

/**
 * Resolve the user's workspace and run `fn` inside that tenant context. This is how
 * a request becomes tenant-scoped: wrap the handler body so every tenantId() inside
 * returns THIS user's workspace. (Wiring this into the route layer + flipping legacy
 * queries is the verification-gated rollout step.)
 */
export async function withUserTenant<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const tenantId = await ensureWorkspaceForUser(userId);
  return runWithTenant({ tenantId, userId }, fn);
}
