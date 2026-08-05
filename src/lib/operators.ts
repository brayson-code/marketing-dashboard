// Managing who can run the operator surfaces — SERVER.
//
// The allow-list itself is one table (0063), but "give Carl access" is more than a row:
// the middleware bounces anyone with no workspace to /no-workspace BEFORE they can reach
// Portal Admin, so an operator with an allow-list entry and no workspace still cannot
// get in. Every KeyPlayers staffer already has their own personal workspace
// ("olivias workspace"), so provisioning an operator follows that same shape.
//
// Kept out of a migration on purpose. Seeding the first two people in SQL was fine;
// needing a database migration every time Client Success hires someone is not.

import { sql } from './db/client';
import { grantAccess, type GrantResult } from './workspace-lifecycle';

export interface Operator {
  email: string;
  note: string | null;
  created_at: string;
  /** False when they have no login yet — an allow-list entry alone cannot sign in. */
  has_login: boolean;
  workspace: string | null;
}

export async function listOperators(): Promise<Operator[]> {
  const rows = (await sql()`
    SELECT o.email, o.note, o.created_at,
           u.id AS user_id,
           t.name AS workspace
    FROM public.platform_operators o
    LEFT JOIN auth.users u ON lower(u.email) = lower(o.email)
    LEFT JOIN public.workspace_members m ON m.user_id = u.id
    LEFT JOIN public.tenants t ON t.id = m.workspace_id
    ORDER BY o.created_at, o.email
  `) as unknown as Array<Record<string, unknown>>;

  // The join can fan out if someone belongs to more than one workspace; keep the first.
  const seen = new Map<string, Operator>();
  for (const r of rows) {
    const email = String(r.email).toLowerCase();
    if (seen.has(email)) continue;
    seen.set(email, {
      email,
      note: (r.note as string) ?? null,
      created_at: new Date(r.created_at as string).toISOString(),
      has_login: !!r.user_id,
      workspace: (r.workspace as string) ?? null,
    });
  }
  return [...seen.values()];
}

export async function addOperator(email: string, note: string | null): Promise<string | null> {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean.includes('@')) return null;
  await sql()`
    INSERT INTO public.platform_operators (email, note)
    VALUES (${clean}, ${note})
    ON CONFLICT (email) DO UPDATE SET note = COALESCE(EXCLUDED.note, platform_operators.note)
  `;
  return clean;
}

/**
 * Remove someone from the allow-list.
 *
 * Does NOT delete their account or their workspace — losing operator access should not
 * cost someone their login. Refuses to remove the last operator, because an empty
 * allow-list plus nobody in the HQ workspace would lock the surfaces for everyone.
 */
export async function removeOperator(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = String(email ?? '').trim().toLowerCase();
  const rows = (await sql()`SELECT count(*)::int AS n FROM public.platform_operators`) as unknown as Array<{ n: number }>;
  if ((rows[0]?.n ?? 0) <= 1) {
    return { ok: false, error: 'That is the last operator. Add someone else first.' };
  }
  await sql()`DELETE FROM public.platform_operators WHERE lower(email) = ${clean}`;
  return { ok: true };
}

/**
 * Give an operator a login and their own workspace.
 *
 * Their own workspace, NOT the KeyPlayers HQ one: HQ membership carries the platform
 * engineering surfaces (Issues, the Security Console), which is a much larger grant than
 * "can set a client up". Operator status comes from the allow-list instead.
 *
 * Idempotent — running it again for someone who already has a workspace just refreshes
 * their sign-in link.
 */
export async function provisionOperatorLogin(email: string, origin: string): Promise<GrantResult> {
  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean.includes('@')) {
    return { email, role: 'owner', link: null, error: 'Not a valid email' };
  }

  const existing = (await sql()`
    SELECT m.workspace_id FROM auth.users u
    JOIN public.workspace_members m ON m.user_id = u.id
    WHERE lower(u.email) = ${clean}
    LIMIT 1
  `) as unknown as Array<{ workspace_id: string }>;

  let workspaceId = existing[0]?.workspace_id;
  if (!workspaceId) {
    // Matches the existing convention for staff workspaces, and ACTIVE rather than
    // provisioned — this is a person's own workspace, not a client's pending one.
    const name = `${clean.split('@')[0]}'s workspace`;
    const created = (await sql()`
      INSERT INTO public.tenants (name, plan, status, activated_at)
      VALUES (${name}, 'starter', 'active', now())
      RETURNING id
    `) as unknown as Array<{ id: string }>;
    workspaceId = String(created[0].id);
  }

  return grantAccess(workspaceId, clean, 'owner', origin, null);
}
