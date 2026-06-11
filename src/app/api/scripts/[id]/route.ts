import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { getDraft, updateDraft } from '@/lib/drafts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/scripts/:id — one reel script. 404 if it isn't this tenant's.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const scriptId = Number(id);
    if (!Number.isFinite(scriptId)) {
      return NextResponse.json({ error: 'Invalid script id' }, { status: 400 });
    }
    const script = await getDraft(scriptId);
    if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    return NextResponse.json({ script });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH /api/scripts/:id { payload?, title? } — edit the script text and/or title.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const scriptId = Number(id);
    if (!Number.isFinite(scriptId)) {
      return NextResponse.json({ error: 'Invalid script id' }, { status: 400 });
    }

    let body: { payload?: unknown; title?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.payload !== undefined && typeof body.payload !== 'string') {
      return NextResponse.json({ error: 'payload must be a string' }, { status: 400 });
    }
    if (body.title !== undefined && typeof body.title !== 'string') {
      return NextResponse.json({ error: 'title must be a string' }, { status: 400 });
    }

    const script = await updateDraft(scriptId, {
      payload: body.payload as string | undefined,
      title: body.title as string | undefined,
    });
    if (!script) return NextResponse.json({ error: 'Script not found' }, { status: 404 });
    return NextResponse.json({ script });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
