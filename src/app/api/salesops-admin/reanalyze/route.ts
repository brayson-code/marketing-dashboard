// /api/salesops-admin/reanalyze — SESSION-authed MANUAL "re-derive the active playbook from
// evidence" step (Playbook Studio Phase 2). This is the ONLY way a change-set is created, and
// it runs only on an explicit owner click. NON-DESTRUCTIVE: it never mutates a playbook — it
// loads the CURRENT active playbook + the selected extracted sources, asks the model (BYO key,
// tool-forced) for a typed/cited/confidence-rated CHANGE-SET, and stages it as a PENDING
// salesops_playbook_changesets row. Applying it is a separate owner click (changeset/apply).
//
//   POST { source_ids?: string[] } → { changeset: { id, status, summary, changes, ... } }  [owner|member]
//
// Inputs:
//   - the ACTIVE salesops_playbooks row (is_active=true) → its content is the base.
//   - the extracted sources: the given source_ids (status='extracted' only), or ALL extracted
//     sources when source_ids is absent/empty.
// Errors (all opaque, never leak provider detail):
//   no active playbook         → 400 {error:'no_active_playbook'}
//   zero usable sources        → 400 {error:'no_sources'}
//   no Anthropic key connected → 400 {error:'connect_anthropic'}
//   any other provider failure → 502 {error:'reanalyze_failed'}
//
// Same auth+flag+tenant preamble as playbook/apply. All queries tenant-scoped via tagged-template
// params (the source loading goes through @/lib/salesops/sources, which is tenant-scoped too).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId, jsonb } from '@/lib/db/client';
import { NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import { CONNECT_ANTHROPIC, type PlaybookContent } from '@/lib/salesops/playbook-gen';
import { listExtractedSources } from '@/lib/salesops/sources';
import { reanalyzePlaybook } from '@/lib/salesops/reanalyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

interface ActivePlaybookRow {
  id: string;
  content: PlaybookContent;
}

interface ChangesetRow {
  id: string;
  status: string;
  summary: string | null;
  changes: unknown;
  sources_used: unknown;
  base_playbook_id: string | null;
  applied_playbook_id: string | null;
  created_at: Date | string;
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

  let body: Record<string, unknown> = {};
  try {
    const raw = await request.json();
    if (raw && typeof raw === 'object') body = raw as Record<string, unknown>;
  } catch {
    // body is optional for this route — an empty/absent body means "all extracted sources".
    body = {};
  }

  const sourceIds = Array.isArray(body.source_ids)
    ? body.source_ids.map((x) => String(x)).filter(Boolean)
    : undefined;

  const s = sql();

  // (1) Load the ACTIVE playbook (tenant-scoped). content is jsonb → already-parsed PlaybookContent.
  const activeRows = (await s`
    SELECT id, content
    FROM salesops_playbooks
    WHERE tenant_id = ${tenantId()} AND is_active = true
    LIMIT 1
  `) as unknown as ActivePlaybookRow[];
  const active = activeRows[0];
  if (!active) {
    return NextResponse.json({ error: 'no_active_playbook' }, { status: 400 });
  }

  // (2) Load the selected extracted sources (tenant-scoped; content guaranteed non-empty).
  const sources = await listExtractedSources(sourceIds);
  if (sources.length === 0) {
    return NextResponse.json({ error: 'no_sources' }, { status: 400 });
  }

  // (3) MANUAL reanalyze: ask the model (BYO key, tool-forced) for the change-set. The lib
  // normalizes/clamps (drops unknown-field / type-mismatched / uncited changes) before returning.
  let changeset;
  try {
    changeset = await reanalyzePlaybook(active.content, sources);
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    if (msg === CONNECT_ANTHROPIC) {
      return NextResponse.json({ error: 'connect_anthropic' }, { status: 400 });
    }
    // Everything else (provider/parse/billing) is opaque — never leak the underlying error.
    return NextResponse.json({ error: 'reanalyze_failed' }, { status: 502 });
  }

  // (4) Stage as a PENDING changeset row (tenant-scoped). base_playbook_id = the active id we
  // computed against; sources_used = the ids actually fed to the run. This is the ONLY writer.
  const sourcesUsed = sources.map((src) => src.id);
  const uid = currentUserId();
  const insertedRows = (await s`
    INSERT INTO salesops_playbook_changesets
      (tenant_id, base_playbook_id, status, summary, changes, sources_used, created_by)
    VALUES (
      ${tenantId()}, ${active.id}, 'pending', ${changeset.summary},
      ${jsonb(changeset.changes)}, ${jsonb(sourcesUsed)}, ${uid}
    )
    RETURNING id, status, summary, changes, sources_used, base_playbook_id,
              applied_playbook_id, created_at
  `) as unknown as ChangesetRow[];

  return NextResponse.json({ changeset: insertedRows[0] });
}
