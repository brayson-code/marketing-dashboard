// /api/salesops-admin/tokens — SESSION-authed CRUD for the per-tenant SalesOps tokens
// the browser extension authenticates with. This is the OWNER-facing management surface
// (the SalesOps page), so it is NOT in proxy.ts isPublicPath() — the normal middleware
// enforces the Supabase session, and we additionally hard-gate to owner|member.
//
//   GET            → list this tenant's tokens (NO hashes)              [owner|member]
//   POST { label } → mint a new token, returns the raw value ONCE       [owner|member]
//   DELETE { id }  → revoke a token (soft-delete via revoked_at)        [owner|member]
//
// The token-AUTHED, extension-facing routes live under /api/salesops/* (Engineer A) and
// are deliberately kept on a separate path so the two auth models never overlap. The raw
// token leaves the server exactly once (here, on mint) and is never persisted or logged.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import {
  createSalesopsToken,
  listSalesopsTokens,
  revokeSalesopsToken,
} from '@/lib/salesops/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** SALESOPS_ENABLED off → 404 (feature invisible). Mirrors the movie-clips kill switch. */
function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
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

  const tokens = await listSalesopsTokens();
  return NextResponse.json({ tokens });
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

  let body: { label?: string } = {};
  try {
    body = (await request.json()) as { label?: string };
  } catch {
    /* empty body is fine — label is optional */
  }
  const label = (body.label ?? '').trim().slice(0, 120) || null;

  // createSalesopsToken returns the raw token ONCE — surface it to the rep immediately;
  // it is not recoverable (only the hash is stored).
  const { id, token } = await createSalesopsToken({ label: label ?? undefined });
  return NextResponse.json({ id, token, label });
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

  let body: { id?: string };
  try {
    body = (await request.json()) as { id?: string };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const id = (body.id ?? '').trim();
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  // Tenant-scoped revoke (the WHERE tenant_id guard in revokeSalesopsToken prevents
  // revoking another workspace's token). Idempotent.
  await revokeSalesopsToken(id);
  return NextResponse.json({ ok: true, id });
}
