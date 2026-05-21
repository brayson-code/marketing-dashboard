import { NextResponse } from 'next/server';
import { runProactiveSweep, gatherSignals } from '@/lib/proactive';

export async function GET() {
  // Dry-run: just show signals without invoking KeyPlayer.
  return NextResponse.json({ signals: await gatherSignals(), invoked: false, mode: 'dry_run' });
}

export async function POST() {
  // Fire-and-forget so the caller (cron/UI button) gets a fast 202.
  void runProactiveSweep()
    .then((r) => {
      if (r.error) console.error('[proactive] sweep error:', r.error);
    })
    .catch((err) => console.error('[proactive] unexpected:', err));
  return NextResponse.json({ ok: true, mode: 'dispatched' }, { status: 202 });
}
