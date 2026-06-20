// /api/salesops-admin/changeset/discard — SESSION-authed DISCARD of a pending reanalyze
// change-set (Playbook Studio Phase 2). Flips a PENDING change-set to 'discarded' so it leaves
// the review panel without ever touching a playbook. NON-DESTRUCTIVE: discard only updates the
// change-set's own status — no playbook/config write happens.
//
//   POST { changeset_id } → { ok: true, status: 'discarded' }                  [owner|member]
//
// Errors:
//   missing changeset_id   → 400
//   not found              → 404 {error:'changeset_not_found'}
//   not pending            → 409 {error:'not_pending'}
//
// Same auth+flag+tenant preamble as the other salesops-admin routes. Tenant-scoped.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

interface ChangesetStatusRow {
  id: string;
  status: string;
}

export async function POST(request: Request) {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const changesetId = str(body.changeset_id);
  if (!changesetId) {
    return NextResponse.json({ error: 'changeset_id is required' }, { status: 400 });
  }

  const s = sql();

  // Load + guard state (tenant-scoped). Only a PENDING change-set can be discarded; applied ones
  // stay as immutable history.
  const rows = (await s`
    SELECT id, status
    FROM salesops_playbook_changesets
    WHERE id = ${changesetId} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as ChangesetStatusRow[];
  const cs = rows[0];
  if (!cs) {
    return NextResponse.json({ error: 'changeset_not_found' }, { status: 404 });
  }
  if (cs.status !== 'pending') {
    return NextResponse.json({ error: 'not_pending' }, { status: 409 });
  }

  await s`
    UPDATE salesops_playbook_changesets
    SET status = 'discarded', updated_at = now()
    WHERE id = ${cs.id} AND tenant_id = ${tenantId()}
  `;

  return NextResponse.json({ ok: true, status: 'discarded' });
}
