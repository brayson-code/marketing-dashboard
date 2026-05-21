import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runProactiveSweep } from '@/lib/proactive';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled proactive sweep (Vercel Cron). Watches stalled goals, pending
// drafts, and long-running tasks, and pings the owner when something needs
// attention. after() keeps the function alive until the (slow) sweep finishes.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    try {
      const r = await runProactiveSweep();
      if (r.error) console.error('[cron:proactive] error:', r.error);
    } catch (err) {
      console.error('[cron:proactive] unexpected:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'proactive' }, { status: 202 });
}
