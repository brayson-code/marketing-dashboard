import { NextRequest, NextResponse } from 'next/server';
import { logAudit } from '@/lib/audit';
import { requireUser } from '@/lib/auth';
import {
  createCronJob,
  updateCronJob,
  deleteCronJob,
  listCronJobs,
  normalizeJobId,
} from '@/lib/cron-store';

export const dynamic = 'force-dynamic';

function statusFor(msg: string): number {
  if (msg === 'Not found') return 404;
  if (msg.includes('already exists')) return 409;
  return 400;
}

export async function GET() {
  try {
    const jobs = await listCronJobs();
    return NextResponse.json({ jobs, can_write: true });
  } catch (error) {
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    await createCronJob(body?.job ?? {});
    await logAudit({ actor: requireUser(req as unknown as Request), action: 'cron.create', target: `cron:${body?.job?.id}`, detail: null });
    return NextResponse.json({ ok: true, jobs: await listCronJobs() });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    return NextResponse.json({ error: msg }, { status: statusFor(msg) });
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  try {
    await updateCronJob(body?.job ?? {});
    await logAudit({ actor: requireUser(req as unknown as Request), action: 'cron.update', target: `cron:${body?.job?.id}`, detail: null });
    return NextResponse.json({ ok: true, jobs: await listCronJobs() });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    return NextResponse.json({ error: msg }, { status: statusFor(msg) });
  }
}

export async function DELETE(req: NextRequest) {
  const id = normalizeJobId(req.nextUrl.searchParams.get('id') || req.nextUrl.searchParams.get('jobId'));
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    await deleteCronJob(id);
    await logAudit({ actor: requireUser(req as unknown as Request), action: 'cron.delete', target: `cron:${id}`, detail: null });
    return NextResponse.json({ ok: true, jobs: await listCronJobs() });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    return NextResponse.json({ error: msg }, { status: statusFor(msg) });
  }
}
