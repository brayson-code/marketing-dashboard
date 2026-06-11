import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { listAgentDefs, createAgentDef } from '@/lib/agent-defs';

export const dynamic = 'force-dynamic';

// GET /api/agents/defs — list all agent definitions (Agent Studio).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ agents: await listAgentDefs() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/agents/defs — create a new (custom) agent.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  const body = await request.json().catch(() => ({}));
  try {
    const agent = await createAgentDef(body);
    return NextResponse.json({ agent });
  } catch (error) {
    const msg = (error as Error).message;
    return NextResponse.json({ error: msg }, { status: msg.includes('exists') ? 409 : 400 });
  }
}
