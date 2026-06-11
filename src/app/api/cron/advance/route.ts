import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runAndChain } from '@/lib/waves';
import { runWithTenant } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // one wave (2-3 agents in parallel) + synthesis

// Internal self-trigger for auto-advancing campaigns. runAndChain runs the next
// wave, then re-POSTs here for the wave after that — so a campaign flows end-to-end
// with each wave in its own fresh 300s function. Secret-gated (CRON_SECRET); the
// path is in the proxy's CRON_RUNNER_PATHS so the self-call bypasses the auth gate.
//
// tenant_id is REQUIRED in the body: this route has no Supabase session, so without
// an explicit tenant runAndChain would run under the HQ default and loadCampaign's
// `tenant_id = tenantId()` filter would miss the real-tenant mission — silently
// stopping the wave chain (the bug that stalled every client mission at wave 1).
// The CRON_SECRET gate proves the caller is us, so the body tenant_id is trusted.
export async function POST(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  let id: string | undefined;
  let tenant: string | undefined;
  try {
    const body = (await request.json()) ?? {};
    id = body.id;
    tenant = typeof body.tenant_id === 'string' && body.tenant_id ? body.tenant_id : undefined;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON { id, tenant_id }' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
  after(async () => {
    try {
      // Run inside the mission's tenant context when provided; legacy callers
      // that omit tenant_id fall back to the system default (HQ) as before.
      if (tenant) {
        await runWithTenant({ tenantId: tenant, userId: null }, () => runAndChain(id!));
      } else {
        await runAndChain(id!);
      }
    } catch (err) {
      console.error(`[cron:advance] ${id} failed:`, (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: id }, { status: 202 });
}
