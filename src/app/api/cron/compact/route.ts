import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { spawnSubAgent } from '@/lib/subagent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Scheduled memory compaction (Vercel Cron). Rolls up recent boardroom + task
// activity into a durable memory rollup the orchestrator loads on its next call.
export async function GET(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  after(async () => {
    try {
      const r = await spawnSubAgent('memory-compactor', 'Compact the recent boardroom + task activity into a structured rollup using your output schema.');
      if (!r.ok) console.error('[cron:compact] error:', r.error);
    } catch (err) {
      console.error('[cron:compact] unexpected:', (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: 'compact' }, { status: 202 });
}
