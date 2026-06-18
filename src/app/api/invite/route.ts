// POST /api/invite — invite a teammate into the CURRENT workspace (same-tenant
// sibling of /api/clients, which provisions a whole new tenant).
//
// Now a REAL invite: we create (or reuse) the auth user, add a workspace_members
// row for THIS tenant, stamp the JWT tenant claim when they have no real
// workspace yet, generate the same recovery-style sign-in link the clients route
// uses (/auth/confirm → /auth/set-password), and best-effort email it.
//
// We still don't have an `invites` table (the brief explicitly said NOT to
// migrate one), so the pending-invite record keeps living in
// tenants.business_profile.invites — now with user_id + emailed fields. When a
// real invites table lands, migrate this array forward.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { supabaseAdmin, findUserByEmail } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications';
import { sendTransactionalEmail, renderInviteEmail } from '@/lib/transactional-email';
import { requireOwner } from '@/lib/authz/owner-gate';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Role = 'admin' | 'editor' | 'viewer';

function normalizeRole(value: unknown): Role {
  if (value === 'admin' || value === 'editor' || value === 'viewer') return value;
  // Matches /api/users default — invitees land as editors unless asked otherwise.
  return 'editor';
}

// workspace_members.role is CHECK-constrained to ('owner','member','va') — see
// migration 0021. The invite-facing roles above are app-level, so every invitee's
// MEMBERSHIP row lands as 'member'; the finer role rides along in the
// business_profile.invites record for when role-based UI needs it.
const MEMBERSHIP_ROLE = 'member';

const EMAIL_RE = /\S+@\S+\.\S+/;

interface InviteRecord {
  email: string;
  name?: string;
  role: Role;
  status: 'invited';
  invited_at: string;
  user_id?: string;
  emailed?: boolean;
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  // Fail-closed tenancy: an authenticated user with no workspace resolves to the
  // nil-uuid sentinel — there is nothing to invite anyone INTO.
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ ok: false, error: 'No active workspace' }, { status: 403 });
  }

  // Member management is OWNER-ONLY (VA permission matrix / audit finding #2: today
  // any member can invite). Hard 403 for non-owners, independent of AUTHZ_ENFORCE —
  // single-owner prod is unaffected (the owner always passes). Mirrors
  // policies/members.ts (action 'invite').
  const gate = await requireOwner();
  if (gate) return gate;

  let body: { email?: string; name?: string; role?: string };
  try {
    body = (await request.json()) as { email?: string; name?: string; role?: string };
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON' }, { status: 400 });
  }

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json({ ok: false, error: 'Valid email is required' }, { status: 400 });
  }

  const role = normalizeRole(body.role);
  const name = typeof body.name === 'string' && body.name.trim().length > 0 ? body.name.trim() : undefined;

  try {
    const admin = supabaseAdmin();

    // Workspace name for the email copy — also a sanity check the tenant row exists.
    const trows = (await sql()`
      SELECT name, business_profile FROM public.tenants
      WHERE id = ${tenantId()}
    `) as unknown as Array<{ name: string; business_profile: Record<string, unknown> | null }>;
    if (!trows[0]) {
      return NextResponse.json({ ok: false, error: 'Workspace not found' }, { status: 404 });
    }
    const workspaceName = trows[0].name;

    // 1) Reuse or create the auth user. If they already belong to a DIFFERENT real
    //    workspace, refuse — one workspace per user for now (same rule as /api/clients).
    let userId: string;
    let existingMeta: Record<string, unknown> = {};
    const existing = await findUserByEmail(email);
    if (existing) {
      const claimed = existing.app_metadata?.tenant_id;
      if (typeof claimed === 'string' && claimed && claimed !== NO_TENANT_ID && claimed !== tenantId()) {
        return NextResponse.json(
          { ok: false, error: 'That email already belongs to a different workspace' },
          { status: 409 },
        );
      }
      userId = existing.id;
      existingMeta = existing.app_metadata;
    } else {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
      if (error || !data.user) {
        return NextResponse.json({ ok: false, error: error?.message ?? 'Could not create user' }, { status: 500 });
      }
      userId = data.user.id;
    }

    // 2) Membership in THIS workspace (idempotent — re-inviting is a no-op here).
    await sql()`
      INSERT INTO public.workspace_members (workspace_id, user_id, role)
      VALUES (${tenantId()}, ${userId}, ${MEMBERSHIP_ROLE})
      ON CONFLICT (workspace_id, user_id) DO NOTHING
    `;

    // 3) Stamp the JWT tenant claim ONLY when they have no real workspace yet (the
    //    nil-uuid sentinel means a prior attempt half-finished — safe to retry).
    //    Non-fatal on failure: resolveTenant falls back to the membership row.
    const claimed = existingMeta.tenant_id;
    if (!(typeof claimed === 'string' && claimed && claimed !== NO_TENANT_ID)) {
      const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
        app_metadata: { ...existingMeta, tenant_id: tenantId() },
      });
      if (metaErr) console.error('[invite POST] claim stamp failed (membership row still resolves):', metaErr);
    }

    // 4) Best-effort sign-in link — same recovery-token style as /api/clients:
    //    our own /auth/confirm verifies the token_hash server-side, sets the
    //    session cookie, and lands them on /auth/set-password.
    let inviteLink: string | null = null;
    try {
      const origin = request.headers.get('origin') || new URL(request.url).origin;
      const { data: link } = await admin.auth.admin.generateLink({ type: 'recovery', email });
      const hashed = link?.properties?.hashed_token as string | undefined;
      inviteLink = hashed
        ? `${origin}/auth/confirm?token_hash=${hashed}&type=recovery&next=/auth/set-password`
        : ((link?.properties?.action_link as string | undefined) ?? null);
    } catch { /* inviter can re-send later */ }

    // 5) Best-effort email. The invite stands either way — when no provider is
    //    configured the UI shows the copyable link instead.
    let emailed = false;
    let emailReason: string | undefined;
    if (inviteLink) {
      const { html, text } = renderInviteEmail({
        heading: `You've been invited to join ${workspaceName}`,
        body: `You've been invited to join the ${workspaceName} workspace on KeyPlayers Command Center. Click below to sign in and set your password.`,
        ctaLabel: 'Join the workspace',
        link: inviteLink,
      });
      const result = await sendTransactionalEmail({
        to: email,
        subject: `You've been invited to join ${workspaceName} on KeyPlayers`,
        html,
        text,
      }).catch((e) => ({ sent: false, reason: (e as Error).message } as const));
      emailed = result.sent;
      emailReason = result.reason;
    } else {
      emailReason = 'no invite link generated';
    }

    // 6) Keep the pending-invite record in business_profile.invites (replace by
    //    email so re-invites update in place). Last-write-wins is fine for an
    //    onboarding step; worst case is one extra email.
    const profile = (trows[0].business_profile ?? {}) as Record<string, unknown>;
    const existingInvites = Array.isArray(profile.invites) ? (profile.invites as InviteRecord[]) : [];
    const filtered = existingInvites.filter((i) => (i?.email ?? '').toLowerCase() !== email);
    const record: InviteRecord = {
      email,
      name,
      role,
      status: 'invited',
      invited_at: new Date().toISOString(),
      user_id: userId,
      emailed,
    };
    await sql()`
      UPDATE public.tenants
      SET business_profile = ${jsonb({ ...profile, invites: [...filtered, record] })}
      WHERE id = ${tenantId()}
    `;

    await createNotification({
      type: 'invite_sent',
      severity: 'info',
      title: 'Teammate invited',
      message: emailed
        ? `${email} was emailed an invite to ${workspaceName}.`
        : `${email} was added to ${workspaceName} — email not sent (${emailReason ?? 'unknown'}); share their sign-in link manually.`,
      data: { email, name, role, emailed },
    }).catch(() => { /* notification is best-effort */ });

    // Audit the privileged action (audit finding #2: invite had no audit trail).
    // Written directly with the real actor_id = currentUserId() — the same pattern
    // the ABAC guard + api-auth.ts use — so the trail is non-anonymous without
    // depending on the legacy logAudit() User shape (its actor_id wiring is a
    // separate quick-win owned elsewhere).
    try {
      await sql()`
        INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
        VALUES (
          ${tenantId()}, ${currentUserId()}, ${null},
          ${'invite'}, ${email},
          ${JSON.stringify({ role, name: name ?? null, user_id: userId, emailed })}
        )
      `;
    } catch { /* audit is best-effort; never block the invite on a log failure */ }

    return NextResponse.json({
      ok: true, email, status: 'invited', inviteLink,
      emailed, email_reason: emailReason ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'invite failed';
    console.error('[invite POST]', err);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
