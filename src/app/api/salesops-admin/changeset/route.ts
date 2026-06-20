// /api/salesops-admin/changeset — SESSION-authed list of this tenant's reanalyze change-sets
// (Playbook Studio Phase 2 review panel). Read-only. Rows are written ONLY by .../reanalyze
// (one PENDING row per manual run) and transitioned by changeset/apply + changeset/discard.
//
//   GET ?status=pending|applied|discarded → { changesets: ChangesetRow[] }  newest-first  [owner|member]
//     omit ?status → all change-sets for the tenant.
//
// Same auth+flag+tenant preamble as the other salesops-admin routes. Tenant-scoped query.

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

const VALID_STATUS = ['pending', 'applied', 'discarded'] as const;
type ChangesetStatus = (typeof VALID_STATUS)[number];

interface ChangesetRow {
  id: string;
  status: string;
  summary: string | null;
  changes: unknown;
  sources_used: unknown;
  base_playbook_id: string | null;
  applied_playbook_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export async function GET(request: Request) {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  const { searchParams } = new URL(request.url);
  const statusParam = (searchParams.get('status') ?? '').trim();
  const status: ChangesetStatus | null = (VALID_STATUS as readonly string[]).includes(statusParam)
    ? (statusParam as ChangesetStatus)
    : null;

  const s = sql();
  // Tenant-scoped, indexed by (tenant_id, created_at desc). Both branches param-bind status —
  // no string interpolation. When no/invalid status filter is given, return all for the tenant.
  const changesets = status
    ? ((await s`
        SELECT id, status, summary, changes, sources_used, base_playbook_id,
               applied_playbook_id, created_at, updated_at
        FROM salesops_playbook_changesets
        WHERE tenant_id = ${tenantId()} AND status = ${status}
        ORDER BY created_at DESC
        LIMIT 100
      `) as unknown as ChangesetRow[])
    : ((await s`
        SELECT id, status, summary, changes, sources_used, base_playbook_id,
               applied_playbook_id, created_at, updated_at
        FROM salesops_playbook_changesets
        WHERE tenant_id = ${tenantId()}
        ORDER BY created_at DESC
        LIMIT 100
      `) as unknown as ChangesetRow[]);

  return NextResponse.json({ changesets });
}
