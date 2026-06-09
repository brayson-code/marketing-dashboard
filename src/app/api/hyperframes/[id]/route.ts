import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getDraft, updateDraft, updateDraftMetadata } from '@/lib/drafts';
import { isComposition } from '@/lib/hyperframes-composition';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/hyperframes/:id — one storyboard draft (incl. metadata.composition).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const draftId = Number(id);
    if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH /api/hyperframes/:id { composition?, title? } — save the visual
// composition (into metadata) and/or rename. The markdown payload is untouched.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    enterTenant(await resolveTenant());
    const { id } = await params;
    const draftId = Number(id);
    if (!Number.isFinite(draftId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    let body: { composition?: unknown; title?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    if (body.title !== undefined) {
      if (typeof body.title !== 'string') return NextResponse.json({ error: 'title must be a string' }, { status: 400 });
      await updateDraft(draftId, { title: body.title });
    }

    if (body.composition !== undefined) {
      if (!isComposition(body.composition)) {
        return NextResponse.json({ error: 'composition must be a { version, aspect, scenes[] } object' }, { status: 400 });
      }
      const draft = await updateDraftMetadata(draftId, { composition: body.composition });
      if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      return NextResponse.json({ draft });
    }

    const draft = await getDraft(draftId);
    if (!draft) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ draft });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
