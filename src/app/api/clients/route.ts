import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { currentUserId, DEFAULT_TENANT_ID, NO_TENANT_ID } from '@/lib/tenant';
import { supabaseAdmin, findUserByEmail } from '@/lib/supabase/admin';
import { createWorkspace } from '@/lib/workspace';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /^\S+@\S+\.\S+$/;

// Clients (= separate tenants) are provisioned by the PLATFORM owner only — i.e. a
// user operating inside the HQ tenant with the 'owner' role. This is the in-app
// version of scripts/create-client.ts.
async function isHqOwner(): Promise<boolean> {
  if (tenantId() !== DEFAULT_TENANT_ID) return false;
  const uid = currentUserId();
  if (!uid) return false;
  const rows = (await sql()`
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ${DEFAULT_TENANT_ID} AND user_id = ${uid} AND role = 'owner'
    LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

// GET /api/clients → the tenants this platform has provisioned (everything but HQ),
// with the owner's email + setup state, so the admin can see and manage clients.
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isHqOwner())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const rows = (await sql()`
      SELECT t.id, t.name, t.plan, t.onboarding_complete, t.created_at,
             (SELECT u.email
                FROM public.workspace_members m
                JOIN auth.users u ON u.id = m.user_id
                WHERE m.workspace_id = t.id AND m.role = 'owner'
                ORDER BY m.created_at ASC LIMIT 1) AS owner_email
      FROM public.tenants t
      WHERE t.id <> ${DEFAULT_TENANT_ID}
      ORDER BY t.created_at DESC
    `) as unknown as Array<Record<string, unknown>>;
    return NextResponse.json({ clients: rows });
  } catch (error) {
    console.error('[clients GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/clients { name, email } → provision a new client: create (or reuse) the
// auth user, create THEIR own tenant (fires the org-chart + C-suite seed), make them
// owner, stamp the JWT tenant claim, and return a magic invite link to share.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isHqOwner())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { name?: string; email?: string };
  try { body = (await request.json()) as { name?: string; email?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const email = (body.email ?? '').trim().toLowerCase();
  const name = (body.name ?? '').trim();
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'A workspace name is required' }, { status: 400 });

  try {
    const admin = supabaseAdmin();

    // 1) Reuse or create the auth user. If they already belong to a workspace,
    //    refuse (don't silently spin up a second tenant for them).
    let userId: string;
    let existingMeta: Record<string, unknown> = {};
    const existing = await findUserByEmail(email);
    if (existing) {
      const claimed = existing.app_metadata?.tenant_id;
      // Only refuse if they already have a REAL workspace — the nil-uuid sentinel
      // means a prior attempt half-finished, which we want to be able to retry.
      if (typeof claimed === 'string' && claimed && claimed !== NO_TENANT_ID) {
        return NextResponse.json({ error: 'That email already has a workspace' }, { status: 409 });
      }
      userId = existing.id;
      existingMeta = existing.app_metadata;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) {
        return NextResponse.json({ error: error?.message ?? 'Could not create user' }, { status: 500 });
      }
      userId = data.user.id;
    }

    // 2) Reuse an owner workspace from a prior half-finished attempt (created but the
    //    claim stamp failed) instead of orphaning a second tenant on retry; else create
    //    a fresh tenant (fires on_new_tenant_seed → org chart + dormant crons).
    const owned = (await sql()`
      SELECT workspace_id FROM public.workspace_members
      WHERE user_id = ${userId} AND role = 'owner' AND workspace_id <> ${DEFAULT_TENANT_ID}
      ORDER BY created_at DESC LIMIT 1
    `) as unknown as Array<{ workspace_id: string }>;
    const newTenantId = owned[0]?.workspace_id ?? (await createWorkspace(name, userId));

    // 3) Stamp the tenant into the JWT so every request resolves to THEIR workspace.
    const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...existingMeta, tenant_id: newTenantId },
    });
    if (metaErr) {
      // The workspace exists; only the claim failed. Surface the tenant id so the
      // operator can retry (idempotent) without leaking the raw Supabase error.
      console.error('[clients POST] claim stamp failed', metaErr);
      return NextResponse.json(
        { error: 'Workspace created but the tenant claim could not be set — please retry.', tenantId: newTenantId },
        { status: 500 },
      );
    }

    // 4) Best-effort invite link for the owner to share (email delivery is out of
    //    scope; failure here doesn't undo provisioning). We use a RECOVERY link: it
    //    lands the client on /auth/set-password to choose their first password
    //    WITHOUT a current password — the sanctioned "set password without the old
    //    one" path, so it works even with Supabase's "Secure password change"
    //    enabled. redirectTo must be in the Supabase Auth "Redirect URLs" allow-list.
    let inviteLink: string | null = null;
    try {
      const origin = request.headers.get('origin') || new URL(request.url).origin;
      const { data: link } = await admin.auth.admin.generateLink({
        type: 'recovery',
        email,
        options: { redirectTo: `${origin}/auth/set-password` },
      });
      inviteLink = (link?.properties?.action_link as string | undefined) ?? null;
    } catch { /* owner can re-send later */ }

    return NextResponse.json({ ok: true, tenantId: newTenantId, userId, email, inviteLink });
  } catch (error) {
    console.error('[clients POST]', error);
    return NextResponse.json({ error: (error as Error).message || 'Provisioning failed' }, { status: 500 });
  }
}
