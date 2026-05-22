import { NextResponse, after } from 'next/server';
import { verifyCron } from '@/lib/cron-auth';
import { runAndChain } from '@/lib/waves';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // one wave (2-3 agents in parallel) + synthesis

// Internal self-trigger for auto-advancing campaigns. runAndChain runs the next
// wave, then re-POSTs here for the wave after that — so a campaign flows end-to-end
// with each wave in its own fresh 300s function. Secret-gated (CRON_SECRET); the
// path is in the proxy's CRON_RUNNER_PATHS so the self-call bypasses the auth gate.
export async function POST(request: Request) {
  const denied = verifyCron(request);
  if (denied) return denied;
  let id: string | undefined;
  try {
    id = (await request.json())?.id;
  } catch {
    return NextResponse.json({ error: 'Body must be JSON { id }' }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: 'Missing campaign id' }, { status: 400 });
  after(async () => {
    try {
      await runAndChain(id!);
    } catch (err) {
      console.error(`[cron:advance] ${id} failed:`, (err as Error).message);
    }
  });
  return NextResponse.json({ ok: true, dispatched: id }, { status: 202 });
}
