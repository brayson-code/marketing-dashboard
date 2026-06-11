import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { isConnected } from '@/lib/agentmail';
import { provisionInbox, syncInboxes } from '@/lib/agentmail-inboxes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET  /api/integrations/agentmail/inbox — connection status + this tenant's inboxes.
export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) return NextResponse.json({ connected: false, inboxes: [] });
  try {
    // syncInboxes pulls the live list from AgentMail + adopts pre-existing ones.
    return NextResponse.json({ connected: true, inboxes: await syncInboxes() });
  } catch (e) {
    return NextResponse.json({ connected: true, error: (e as Error).message, inboxes: [] }, { status: 502 });
  }
}

// POST /api/integrations/agentmail/inbox — "spawn an email agent": provision a
//      new inbox under the tenant's AgentMail account. Body: { username?, agentId? }.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (!(await isConnected())) {
    return NextResponse.json({ error: 'AgentMail not connected — add your API key in Connections.' }, { status: 400 });
  }
  const body = await request.json().catch(() => ({})) as { username?: string; agentId?: string };
  try {
    const inbox = await provisionInbox({ username: body.username, agentId: body.agentId });
    return NextResponse.json({ ok: true, inbox });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
