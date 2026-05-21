import { NextResponse, after } from 'next/server';
import { listCronJobs, toggleCronJob, markDue, normalizeJobId } from '@/lib/cron-store';
import { runCronJob } from '@/lib/cron-runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // "Run now" executes a sub-agent inline via after()

// GET /api/cron — list jobs in the shape the CronBoard expects.
export async function GET() {
  try {
    const jobs = await listCronJobs();
    // Single-owner cloud build: the authenticated owner manages their own jobs.
    return NextResponse.json({ jobs, can_write: true, can_templates_write: true });
  } catch (error) {
    console.error('GET /api/cron error:', error);
    return NextResponse.json({ error: 'Failed to read cron status' }, { status: 500 });
  }
}

// PUT /api/cron — { id, action: "toggle" | "trigger" }.
// toggle flips enabled; trigger marks the job due and runs it immediately.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const id = normalizeJobId(body?.id ?? body?.jobId);
  const action = body?.action === 'toggle' || body?.action === 'trigger' ? body.action : null;
  if (!id) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  if (!action) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });

  try {
    if (action === 'toggle') {
      await toggleCronJob(id);
      return NextResponse.json({ ok: true });
    }
    // trigger: mark due now (durable) + run immediately in the background.
    await markDue(id);
    after(async () => {
      try {
        await runCronJob(id);
      } catch (err) {
        console.error(`[cron:trigger] ${id} failed:`, (err as Error).message);
      }
    });
    return NextResponse.json({ ok: true, dispatched: id }, { status: 202 });
  } catch (error) {
    const msg = (error as Error).message || String(error);
    const status = msg === 'Not found' ? 404 : 400;
    return NextResponse.json({ error: msg }, { status });
  }
}
