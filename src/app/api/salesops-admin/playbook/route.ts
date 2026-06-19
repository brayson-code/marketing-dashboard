// /api/salesops-admin/playbook — SESSION-authed list of the tenant's saved playbooks
// (Playbook Studio "existing playbooks" section / future split-test UX). Read-only. The
// rows are written by .../playbook/apply (one INSERT per Apply; the active one flagged).
// Same auth as the other salesops-admin routes (session + owner|member; VA blocked), same
// SALESOPS_ENABLED kill switch.
//
//   GET → newest-first list of this tenant's playbooks, active marked         [owner|member]
//
// The heavy `content` / `inputs` jsonb are intentionally NOT selected here (list stays
// small); a detail fetch can read them later. calls_count / won_count are returned now so
// the split-test stats column can light up once Phase 2 wires per-call attribution.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PlaybookListRow {
  id: string;
  name: string;
  is_active: boolean;
  source: string;
  calls_count: number;
  won_count: number;
  created_at: Date | string;
}

export async function GET() {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  // Tenant-scoped, indexed by (tenant_id, created_at desc). Cap to a recent window.
  const playbooks = (await sql()`
    SELECT id, name, is_active, source, calls_count, won_count, created_at
    FROM salesops_playbooks
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
    LIMIT 100
  `) as unknown as PlaybookListRow[];

  return NextResponse.json({ playbooks });
}
