import { NextRequest, NextResponse } from 'next/server';
import { getAgentDef, updateAgentDef, deleteAgentDef } from '@/lib/agent-defs';

export const dynamic = 'force-dynamic';

// GET /api/agents/defs/:id — full definition (incl. soul/agent/skills).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agent = await getAgentDef(id);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

// PUT /api/agents/defs/:id — update fields (takes effect live on the next spawn).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    const agent = await updateAgentDef(id, body);
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

// DELETE /api/agents/defs/:id — only custom agents can be deleted (builtins disable).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ok = await deleteAgentDef(id);
  if (!ok) return NextResponse.json({ error: 'Not found, or a builtin (disable it instead of deleting).' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
