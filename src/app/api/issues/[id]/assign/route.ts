import { NextResponse, after } from 'next/server';
import { getIssue, updateIssue } from '@/lib/observability';
import { runFixer } from '@/lib/fixer';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Assign the Fixer sub-agent to an issue. The fix run (read repo → patch → open
// draft PR) can take a while, so we kick it off with after() and return
// immediately; the board polls for the status/PR to appear.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issue = await getIssue(id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Snappy UI feedback before the (slow) agent run starts.
  await updateIssue(id, { status: 'assigned', assignee: 'fixer' });

  after(async () => {
    try {
      await runFixer(id);
    } catch (err) {
      console.error('[fixer] assign run failed:', (err as Error).message);
    }
  });

  return NextResponse.json({ ok: true, started: true });
}
