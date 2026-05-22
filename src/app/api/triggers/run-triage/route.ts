import { NextResponse } from 'next/server';
import { runTriageSweep } from '@/lib/triage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Manual triage trigger from the UI (authenticated session — this path is NOT in the
// proxy's public set). Fire-and-forget so the button gets a fast 202; the drafts /
// issues pages surface verdicts as they're written via their normal polling.
export async function POST() {
  void runTriageSweep()
    .then((r) => {
      if (r.error) console.error('[triage] sweep error:', r.error);
      else console.log(`[triage] checked ${r.ran}, flagged ${r.flagged}`);
    })
    .catch((err) => console.error('[triage] unexpected:', err));
  return NextResponse.json({ ok: true, mode: 'dispatched' }, { status: 202 });
}
