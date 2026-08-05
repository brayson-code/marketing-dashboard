// Workspace lifecycle — SERVER. Provision dark, open on day one, revoke cleanly.
//
// The state column (0062) is the record of intent. THE AUTH ROWS ARE THE ENFORCEMENT:
//   • provisioned → no auth user, no membership. Nothing exists to sign in with.
//   • active      → users created, memberships written, JWT tenant claim stamped.
//   • paused /
//     offboarded  → membership removed and the JWT claim cleared, which the EXISTING
//                   middleware already handles by redirecting to /no-workspace.
//
// Doing it this way means no new per-request check anywhere. A request-time filter would
// have been a new way for every page in a live product to fail; this reuses paths that
// are already load-bearing and proven.
//
// Keeping the column and the auth rows in step is this module's whole job. Everything
// here is idempotent so a half-finished run can simply be repeated.

import { createClient } from '@supabase/supabase-js';
import { sql } from './db/client';
import { NO_TENANT_ID } from './tenant';
import {
  nextStatus, isWorkspaceStatus,
  type WorkspaceStatus, type LifecycleAction,
} from './workspace-lifecycle-catalog';

export interface WorkspaceLifecycle {
  id: string;
  name: string;
  status: WorkspaceStatus;
  provisioned_at: string | null;
  provisioned_by: string | null;
  activated_at: string | null;
  go_live_on: string | null;
  status_note: string | null;
  members: number;
}

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const day = (v: unknown) => (v ? new Date(v as string).toISOString().slice(0, 10) : null);

export async function listLifecycle(): Promise<WorkspaceLifecycle[]> {
  const rows = (await sql()`
    SELECT t.id, t.name, t.status, t.provisioned_at, t.provisioned_by,
           t.activated_at, t.go_live_on, t.status_note,
           (SELECT count(*) FROM public.workspace_members m WHERE m.workspace_id = t.id)::int AS members
    FROM public.tenants t
    ORDER BY
      CASE t.status WHEN 'provisioned' THEN 0 WHEN 'active' THEN 1
                    WHEN 'paused' THEN 2 ELSE 3 END,
      t.go_live_on NULLS LAST, t.name
  `) as unknown as Array<Record<string, unknown>>;

  return rows.map(r => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    status: (isWorkspaceStatus(r.status) ? r.status : 'active'),
    provisioned_at: iso(r.provisioned_at),
    provisioned_by: (r.provisioned_by as string) ?? null,
    activated_at: iso(r.activated_at),
    go_live_on: day(r.go_live_on),
    status_note: (r.status_note as string) ?? null,
    members: Number(r.members ?? 0),
  }));
}

export async function getLifecycle(tenantId: string): Promise<WorkspaceLifecycle | null> {
  return (await listLifecycle()).find(w => w.id === tenantId) ?? null;
}

/**
 * Stand up a workspace on the onboarding call, DARK.
 *
 * Deliberately does not take an owner: creating no auth user is exactly what keeps the
 * client out until day one. Config, agents and the service profile can all be written
 * against the returned id in the meantime.
 */
export async function provisionWorkspace(input: {
  name: string;
  plan?: string;
  goLiveOn?: string | null;
  by?: string | null;
}): Promise<string> {
  const goLive = /^\d{4}-\d{2}-\d{2}$/.test(String(input.goLiveOn ?? '')) ? input.goLiveOn! : null;
  const rows = (await sql()`
    INSERT INTO public.tenants (name, plan, status, provisioned_at, provisioned_by, go_live_on)
    VALUES (${input.name}, ${input.plan ?? 'starter'}, 'provisioned', now(), ${input.by ?? null}, ${goLive})
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return String(rows[0].id);
}

export interface GrantResult {
  email: string;
  role: 'owner' | 'va';
  /** Sign-in link. Null when Supabase admin credentials aren't configured. */
  link: string | null;
  /** Set when this person could not be granted access, with the reason. */
  error?: string;
}

/**
 * Give one person access to a workspace: auth user, membership, JWT claim, sign-in link.
 *
 * Mirrors /api/invite rather than reimplementing it — same recovery-token style link,
 * which /auth/confirm exchanges for a session and lands on /auth/set-password. No
 * temporary password is ever generated: a link expires, a password ends up in a Slack
 * message forever.
 *
 * Idempotent. Re-running for someone who already has access refreshes their link.
 */
async function grantAccess(
  tenantId: string, email: string, role: 'owner' | 'va', origin: string,
): Promise<GrantResult> {
  const a = admin();
  if (!a) return { email, role, link: null, error: 'Supabase admin credentials not configured' };

  const clean = String(email ?? '').trim().toLowerCase();
  if (!clean || !clean.includes('@')) return { email, role, link: null, error: 'Not a valid email' };

  try {
    // Reuse an existing account when there is one — people are re-invited, and a second
    // account for the same human is worse than no account.
    const { data: list } = await a.auth.admin.listUsers();
    const existing = list?.users?.find(u => u.email?.toLowerCase() === clean);

    let userId: string;
    let meta: Record<string, unknown> = {};
    if (existing) {
      const claimed = existing.app_metadata?.tenant_id;
      if (typeof claimed === 'string' && claimed && claimed !== NO_TENANT_ID && claimed !== tenantId) {
        return { email: clean, role, link: null, error: 'That email already belongs to another workspace' };
      }
      userId = existing.id;
      meta = (existing.app_metadata as Record<string, unknown>) ?? {};
    } else {
      const { data, error } = await a.auth.admin.createUser({ email: clean, email_confirm: true });
      if (error || !data.user) {
        return { email: clean, role, link: null, error: error?.message ?? 'Could not create the login' };
      }
      userId = data.user.id;
    }

    await sql()`
      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (${tenantId}, ${userId}, ${role})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
    `;

    await a.auth.admin.updateUserById(userId, { app_metadata: { ...meta, tenant_id: tenantId } });

    let link: string | null = null;
    try {
      const { data: gen } = await a.auth.admin.generateLink({ type: 'recovery', email: clean });
      const hashed = gen?.properties?.hashed_token as string | undefined;
      link = hashed
        ? `${origin}/auth/confirm?token_hash=${hashed}&type=recovery&next=/auth/set-password`
        : ((gen?.properties?.action_link as string | undefined) ?? null);
    } catch { /* access still stands; the link can be regenerated */ }

    return { email: clean, role, link };
  } catch (err) {
    return { email: clean, role, link: null, error: err instanceof Error ? err.message : 'Failed' };
  }
}

/**
 * Revoke access without destroying anything.
 *
 * Removes the membership AND clears the JWT tenant claim. Both are needed: the
 * middleware reads the claim, while resolveTenant falls back to the membership row, so
 * clearing only one would leave a working way in.
 */
async function revokeAccess(tenantId: string): Promise<number> {
  const rows = (await sql()`
    DELETE FROM public.workspace_members WHERE workspace_id = ${tenantId}
    RETURNING user_id
  `) as unknown as Array<{ user_id: string }>;

  const a = admin();
  if (a) {
    for (const r of rows) {
      try {
        const { data } = await a.auth.admin.getUserById(r.user_id);
        const meta = (data?.user?.app_metadata as Record<string, unknown>) ?? {};
        // Only clear the claim if it points HERE — a user who has since been moved to
        // another workspace must not be cut off from that one.
        if (meta.tenant_id === tenantId) {
          await a.auth.admin.updateUserById(r.user_id, { app_metadata: { ...meta, tenant_id: null } });
        }
      } catch { /* membership is already gone; the claim alone resolves to nothing */ }
    }
  }
  return rows.length;
}

export interface TransitionResult {
  ok: boolean;
  status?: WorkspaceStatus;
  grants?: GrantResult[];
  revoked?: number;
  error?: string;
}

/**
 * Move a workspace through the lifecycle, doing the auth work the new state implies.
 *
 * The transition is validated against the state machine FIRST, so an illegal move (say,
 * activating something already offboarded) is refused rather than half-applied.
 */
export async function transition(
  tenantId: string,
  action: LifecycleAction,
  opts: { emails?: Array<{ email: string; role: 'owner' | 'va' }>; origin?: string; note?: string | null } = {},
): Promise<TransitionResult> {
  const current = await getLifecycle(tenantId);
  if (!current) return { ok: false, error: 'Workspace not found' };

  const target = nextStatus(current.status, action);
  if (!target) {
    return { ok: false, error: `Cannot ${action} a workspace that is ${current.status}` };
  }

  if (action === 'activate') {
    const origin = opts.origin ?? '';
    const people = (opts.emails ?? []).filter(p => p.email?.trim());
    if (people.length === 0) {
      return { ok: false, error: 'At least one email is needed to open a workspace' };
    }
    const grants: GrantResult[] = [];
    for (const p of people) grants.push(await grantAccess(tenantId, p.email, p.role, origin));

    // If nobody got in, this is not an activation — leave the state alone so it can be
    // retried once the cause (bad address, missing admin key) is fixed.
    if (grants.every(g => g.error)) {
      return { ok: false, grants, error: 'Nobody could be given access, so the workspace was left closed' };
    }

    await sql()`
      UPDATE public.tenants
      SET status = ${target}, activated_at = COALESCE(activated_at, now()), status_note = ${opts.note ?? null}
      WHERE id = ${tenantId}
    `;
    return { ok: true, status: target, grants };
  }

  if (action === 'pause' || action === 'offboard') {
    const revoked = await revokeAccess(tenantId);
    await sql()`
      UPDATE public.tenants SET status = ${target}, status_note = ${opts.note ?? null}
      WHERE id = ${tenantId}
    `;
    return { ok: true, status: target, revoked };
  }

  // resume — the logins were removed when it was paused, so access has to be granted
  // again. Same call as activation; activated_at is left as the ORIGINAL day one.
  const origin = opts.origin ?? '';
  const people = (opts.emails ?? []).filter(p => p.email?.trim());
  if (people.length === 0) {
    return { ok: false, error: 'At least one email is needed to reopen a workspace' };
  }
  const grants: GrantResult[] = [];
  for (const p of people) grants.push(await grantAccess(tenantId, p.email, p.role, origin));
  if (grants.every(g => g.error)) {
    return { ok: false, grants, error: 'Nobody could be given access, so the workspace stayed paused' };
  }
  await sql()`
    UPDATE public.tenants SET status = ${target}, status_note = ${opts.note ?? null}
    WHERE id = ${tenantId}
  `;
  return { ok: true, status: target, grants };
}
