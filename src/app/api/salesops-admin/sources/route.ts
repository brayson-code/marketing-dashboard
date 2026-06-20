// /api/salesops-admin/sources — SESSION-authed CRUD for the EVIDENCE the Reanalyze loop reads
// (Playbook Studio Phase 2). A "source" is one piece of evidence the rep adds to re-derive
// their active playbook from: an own closed-won call (sales_calls.id), a creator's Instagram
// (handle/URL, scraped via Apify), or a YouTube/manual paste (text stored as-is in Slice 1).
//
//   GET    → { sources: SourceRecord[] }  newest-first, this tenant's sources    [owner|member]
//   POST   { kind, ref?, label?, niche?, text? } → { source: SourceRecord }      [owner|member]
//            creates the row + extracts content SYNCHRONOUSLY (status flips to
//            'extracted'|'error'); instagram with no Apify key → 400 {error:'connect_apify'}.
//   DELETE { id } → { ok: true, removed: boolean }  tenant-scoped delete         [owner|member]
//
// Same auth+flag+tenant preamble as every salesops-admin route (copied from playbook/apply):
// SALESOPS_ENABLED kill switch → enterTenant(resolveTenant()) → NO_TENANT_ID 403 →
// requireOwnerOrMember (VA blocked). All data work delegates to the tenant-scoped helpers in
// @/lib/salesops/sources — every query there filters on tenantId() as a tagged-template param.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import {
  CONNECT_APIFY,
  createSource,
  deleteSource,
  listSources,
  type CreateSourceInput,
  type SourceKind,
} from '@/lib/salesops/sources';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

const VALID_KINDS: SourceKind[] = ['won_call', 'instagram', 'youtube', 'manual'];

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

export async function GET() {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  const sources = await listSources();
  return NextResponse.json({ sources });
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

  const kind = str(body.kind) as SourceKind;
  if (!VALID_KINDS.includes(kind)) {
    return NextResponse.json({ error: 'invalid_kind' }, { status: 400 });
  }

  const ref = str(body.ref) || null;
  const text = str(body.text);

  // Per-kind required-input validation (fail before we touch Apify / insert a row):
  //  - won_call / instagram need a ref (call id, or handle/url)
  //  - youtube / manual need pasted text (Slice 1: no auto-fetch)
  if ((kind === 'won_call' || kind === 'instagram') && !ref) {
    return NextResponse.json({ error: 'ref_required' }, { status: 400 });
  }
  if ((kind === 'youtube' || kind === 'manual') && !text) {
    return NextResponse.json({ error: 'text_required' }, { status: 400 });
  }

  const input: CreateSourceInput = {
    kind,
    ref,
    label: str(body.label) || null,
    niche: str(body.niche) || null,
    text: text || null,
  };

  try {
    const source = await createSource(input);
    return NextResponse.json({ source });
  } catch (e) {
    // createSource only throws the pre-insert CONNECT_APIFY (BYO-key); extraction failures are
    // recorded on the row as status='error' and returned normally above. Never leak provider err.
    if ((e as Error)?.message === CONNECT_APIFY) {
      return NextResponse.json({ error: 'connect_apify' }, { status: 400 });
    }
    return NextResponse.json({ error: 'create_failed' }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
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

  const id = str(body.id);
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  const removed = await deleteSource(id);
  return NextResponse.json({ ok: true, removed });
}
