// POST /api/clients/decommission-request { tenantId, mode: 'revoke' | 'delete', reason? }
//
// NON-DESTRUCTIVE BY DESIGN. The Command Center can only REQUEST that a client workspace be
// decommissioned — it has zero power to actually ban/delete anything. The request:
//   1) records a security_event (HQ console trail), and
//   2) pages the operator OUT-OF-BAND (platform iMessage) with the exact CLI command to run.
// The destructive action runs only from a trusted operator machine via
// scripts/decommission-client.ts (service-role key, never reachable by a browser). So even a
// fully hijacked HQ session can do no worse than ping the real operator — which tips them off.
// (Audit ops/docs/security-audit-2026-06-18.md: highest-blast-radius ops get owner-only + a
// second factor + source-gating, not a one-click web control.)

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { currentUserId, DEFAULT_TENANT_ID } from '@/lib/tenant';
import { emitSecurityEvent } from '@/lib/security-events';
import { sendPlatformAlertIMessage } from '@/lib/loopmessage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/** HQ platform owner only: acting inside the HQ tenant with the owner role. Mirrors clients GET/POST. */
async function isHqOwner(): Promise<boolean> {
  if (tenantId() !== DEFAULT_TENANT_ID) return false;
  const uid = currentUserId();
  if (!uid) return false;
  const rows = (await sql()`
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ${DEFAULT_TENANT_ID} AND user_id = ${uid} AND role = 'owner'
    LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isHqOwner())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  let body: { tenantId?: string; mode?: string; reason?: string };
  try { body = (await request.json()) as { tenantId?: string; mode?: string; reason?: string }; }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const target = (body.tenantId ?? '').trim();
  const mode = body.mode === 'delete' ? 'delete' : 'revoke';
  const reason = (body.reason ?? '').toString().trim().slice(0, 280);
  if (!target) return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
  if (target === DEFAULT_TENANT_ID) {
    return NextResponse.json({ error: 'HQ cannot be decommissioned' }, { status: 400 });
  }

  const t = (await sql()`
    SELECT name FROM public.tenants WHERE id = ${target} AND id <> ${DEFAULT_TENANT_ID} LIMIT 1
  `) as unknown as Array<{ name: string }>;
  if (!t[0]) return NextResponse.json({ error: 'Client workspace not found' }, { status: 404 });

  // The exact command the operator runs on their trusted machine to actually do it.
  const cli = `npx tsx --env-file=.env.local scripts/decommission-client.ts ${target} ${mode}`;
  const requestedBy = currentUserId() ?? 'unknown';

  // (1) HQ console trail. severity 'warning' so we DON'T also trigger the generic critical
  // alert path — we send a tailored, actionable iMessage ourselves below.
  void emitSecurityEvent({
    type: 'decommission_requested',
    severity: 'warning',
    resourceRef: target,
    detail: { workspace: t[0].name, mode, reason: reason || undefined, cli },
  });

  // (2) Out-of-band page to the operator. Templated raw text (no Claude credits). Best-effort —
  // a delivery failure never fails the request (the console row above is the durable record).
  const msg =
    `⚠️ Decommission REQUESTED\n` +
    `workspace: ${t[0].name}\n` +
    `mode: ${mode.toUpperCase()}${mode === 'delete' ? ' (irreversible)' : ' (reversible)'}\n` +
    `by: ${requestedBy}\n` +
    (reason ? `reason: ${reason}\n` : '') +
    `\nTo execute, run on your operator machine:\n${cli}\n\n` +
    `If you did NOT request this, your HQ session may be compromised — do not run it, and rotate your session.`;
  try { await sendPlatformAlertIMessage(msg); } catch { /* best-effort; console row is the record */ }

  return NextResponse.json({ ok: true, mode, workspace: t[0].name, cli });
}
