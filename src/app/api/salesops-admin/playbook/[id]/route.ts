// /api/salesops-admin/playbook/[id] — SESSION-authed fetch of ONE playbook's full content
// (the list route deliberately omits the heavy `content` jsonb). The Playbook Studio
// "View / edit" action loads this into the editor so the owner can see and revise a saved
// playbook; applying edits creates a NEW version via the non-destructive apply path.
//
//   GET → { playbook: { id, name, is_active, content } }   [owner|member]
//
// Same auth+flag+tenant preamble as the sibling salesops-admin routes; tenant-scoped.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import type { PlaybookContent } from '@/lib/salesops/playbook-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

interface PlaybookRow {
  id: string;
  name: string;
  is_active: boolean;
  content: PlaybookContent;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  const { id } = await params;
  const rows = (await sql()`
    SELECT id, name, is_active, content
    FROM salesops_playbooks
    WHERE id = ${id} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as PlaybookRow[];

  if (!rows[0]) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return NextResponse.json({ playbook: rows[0] });
}
