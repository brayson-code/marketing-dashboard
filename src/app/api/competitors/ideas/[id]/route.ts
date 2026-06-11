import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { setIdeaStatus } from '@/lib/reel-ideas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const VALID_STATUSES = ['kept', 'dismissed', 'proposed'] as const;

// PATCH /api/competitors/ideas/[id] — curate a concept: keep or dismiss it.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const ideaId = Number(id);
  if (!Number.isFinite(ideaId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: { status?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const status = typeof body.status === 'string' ? body.status : '';
    if (!(VALID_STATUSES as readonly string[]).includes(status)) {
      return NextResponse.json({ error: `status must be one of ${VALID_STATUSES.join(', ')}` }, { status: 400 });
    }
    const idea = await setIdeaStatus(ideaId, status);
    if (!idea) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ idea });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
