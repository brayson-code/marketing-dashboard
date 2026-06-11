import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import {
  getAgentDef, getAgentDefForEditor, isKnownBundledAgent,
  updateAgentDef, upsertAgentDef, deleteAgentDef,
} from '@/lib/agent-defs';

export const dynamic = 'force-dynamic';

// GET /api/agents/defs/:id — full definition (incl. soul/agent/skills). Opens
// the saved row, or a bundled built-in not yet seeded for this tenant.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const agent = await getAgentDefForEditor(id);
  if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ agent });
}

// PUT /api/agents/defs/:id — update fields (takes effect live on the next spawn).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  try {
    let agent = await updateAgentDef(id, body);
    if (!agent) {
      // No saved row yet. If this is a known bundled built-in being edited for
      // the first time, materialize it (copy-on-write) with the submitted
      // fields rather than 404-ing. Unknown ids still 404.
      if (!(await isKnownBundledAgent(id))) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
      }
      await upsertAgentDef({ ...body, id, source: 'builtin' });
      agent = await getAgentDef(id);
    }
    if (!agent) return NextResponse.json({ error: 'Save failed' }, { status: 500 });
    return NextResponse.json({ agent });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}

// DELETE /api/agents/defs/:id — only custom agents can be deleted (builtins disable).
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const ok = await deleteAgentDef(id);
  if (!ok) return NextResponse.json({ error: 'Not found, or a builtin (disable it instead of deleting).' }, { status: 400 });
  return NextResponse.json({ ok: true });
}
