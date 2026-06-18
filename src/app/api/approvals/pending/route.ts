// Owner step-up approvals — the OWNER side of the secret-rotation/disconnect flow.
//
// When a VA/member attempts a key/secret rotation (integrations-setup POST with a
// secret) or a disconnect (connections DELETE), the route inserts a pending_approvals
// row INSTEAD of executing (see src/lib/pending-approvals.ts). This endpoint is where
// the OWNER reviews and resolves those requests:
//
//   GET  /api/approvals/pending            → owner lists the tenant's pending requests
//   POST /api/approvals/pending { id, decision } → owner approves/denies; on approve the
//                                            rotation/disconnect executes server-side.
//
// Named `approvals/pending` to avoid colliding with the existing draft-approvals route
// at /api/approvals (which surfaces pending CONTENT/sequence drafts — a different thing).
//
// OWNER-ONLY, real 403, independent of AUTHZ_ENFORCE: resolving a key-rotation request
// is the owner's step-up confirmation; a member/va must not self-approve. Single-owner
// prod is unaffected (the owner is the only member). The execute path is fully
// tenant-scoped (every query in pending-approvals.ts filters tenant_id).
//
// TODO (follow-up): out-of-band one-tap notify link. When a pending approval is
// created, send the owner a one-tap deep link (e.g. SMS/Telegram/email →
// /api/approvals/pending?id=...&action=approve with a signed token) so they can
// confirm without opening the app. Scaffolding (table + create-on-attempt + this
// owner-approve endpoint) is in place; the notify link is intentionally deferred.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId, NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { sql } from '@/lib/db/client';
import { requireOwner } from '@/lib/authz';
import { listPendingApprovals, resolvePendingApproval } from '@/lib/pending-approvals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** GET → the active tenant's pending step-up approvals (owner-only). */
export async function GET() {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwner();
  if (gate) return gate;

  try {
    const pending = await listPendingApprovals();
    return NextResponse.json({ pending, total: pending.length });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

/** POST { id, decision: 'approve' | 'deny' } → resolve one approval (owner-only). */
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwner();
  if (gate) return gate;

  let body: { id?: string | number; decision?: string };
  try {
    body = (await request.json()) as { id?: string | number; decision?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const id = body.id != null ? String(body.id) : '';
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  if (body.decision !== 'approve' && body.decision !== 'deny') {
    return NextResponse.json({ error: "decision must be 'approve' or 'deny'" }, { status: 400 });
  }

  const result = await resolvePendingApproval(id, body.decision);
  if (!result.ok) {
    const status = result.code === 'not_found' ? 404 : result.code === 'already_resolved' ? 409 : 400;
    return NextResponse.json({ ok: false, error: result.error, code: result.code }, { status });
  }

  // Audit the owner's resolution (non-anonymous, actor_id = the owner). Best-effort.
  try {
    await sql()`
      INSERT INTO audit_log (tenant_id, actor_id, actor_username, action, target, detail)
      VALUES (
        ${tenantId()}, ${currentUserId()}, ${null},
        ${`approval.${result.status}`}, ${id},
        ${JSON.stringify({ executed: result.executed })}
      )
    `;
  } catch { /* audit is best-effort */ }

  return NextResponse.json({ ok: true, status: result.status, executed: result.executed });
}
