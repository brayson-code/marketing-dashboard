import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireUser } from '@/lib/auth';
import { reorderCronJobs, listCronJobs } from '@/lib/cron-store';

export const dynamic = 'force-dynamic';

// PATCH /api/cron/order — { ids: string[] }. Persists a new display_order for the
// moved set (drag-to-reorder on the /cron board): ids[i] gets display_order i+1.
// Tenant-scoped (enterTenant); never touches enabled/schedule/next_run_at, so this
// can't perturb the dispatcher — see cron-store.reorderCronJobs / migration 0057.
export async function PATCH(req: NextRequest) {
  enterTenant(await resolveTenant());
  const body = await req.json().catch(() => ({}));
  try {
    await reorderCronJobs(body?.ids ?? []);
    await logAudit({
      actor: requireUser(req as unknown as Request),
      action: 'cron.reorder',
      target: 'cron:order',
      detail: null,
    });
    return NextResponse.json({ ok: true, jobs: await listCronJobs() });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
