import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { isConnected } from '@/lib/agentmail';
import { listInbound, pollInbound } from '@/lib/agentmail-inboxes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/integrations/agentmail/messages — inbound emails for the Engagement
// email lane (newest first). Push-fed by the inbound webhook; ALSO polled here
// as a fallback so the lane works before the webhook (APP_URL) is configured.
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, messages: [] });
  const max = Math.min(100, Math.max(1, Number(new URL(request.url).searchParams.get('max') ?? '30')));
  try {
    // Pull any new inbound from AgentMail (free, deduped) before reading back.
    await pollInbound().catch(() => {});
    return NextResponse.json({ connected: true, messages: await listInbound(max) });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, messages: [] }, { status: 502 });
  }
}
