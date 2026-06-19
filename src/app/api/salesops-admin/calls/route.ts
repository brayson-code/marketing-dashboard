// /api/salesops-admin/calls — SESSION-authed list of the tenant's recorded sales calls
// (the SalesOps page "Review" section). Read-only. The rows are written by the
// extension-facing pipeline (ingestCallSummary) under the token-authed
// /api/salesops/summary route; here we just surface them to the owner.
//
//   GET → newest-first list of sales_calls for the active tenant            [owner|member]

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SalesCallRow {
  id: string;
  started_at: Date | string;
  ended_at: Date | string | null;
  platform: string | null;
  contact_name: string | null;
  contact_email: string | null;
  lead_id: string | null;
  summary: string | null;
  deal_temp: string | null;
  suggestions_count: number;
  metadata: unknown;
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

  // Tenant-scoped, indexed by (tenant_id, started_at desc). Cap to a recent window —
  // the transcript column is intentionally NOT selected (large + not needed for the list).
  const calls = (await sql()`
    SELECT id, started_at, ended_at, platform, contact_name, contact_email, lead_id,
           summary, deal_temp, suggestions_count, metadata
    FROM sales_calls
    WHERE tenant_id = ${tenantId()}
    ORDER BY started_at DESC
    LIMIT 100
  `) as unknown as SalesCallRow[];

  return NextResponse.json({ calls });
}
