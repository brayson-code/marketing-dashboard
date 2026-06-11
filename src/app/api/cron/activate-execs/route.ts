import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireApiEditor } from '@/lib/api-auth';
import { activateExecCrons, execsEnabledCount } from '@/lib/cron-store';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET → how many exec crons are currently enabled (the activation card self-hides
// once any are on).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ enabled: await execsEnabledCount() });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST → enable + schedule all C-suite exec crons at once (the cost-aware opt-in).
export async function POST(req: Request) {
  enterTenant(await resolveTenant());
  const denied = requireApiEditor(req);
  if (denied) return denied;
  try {
    const activated = await activateExecCrons();
    return NextResponse.json({ ok: true, activated });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
