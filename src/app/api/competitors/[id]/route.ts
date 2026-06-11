import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { setCompetitor, removeCompetitor } from '@/lib/competitors';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// PATCH /api/competitors/[id] — partial update of enabled/schedule/display_name.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: { enabled?: boolean; schedule?: string; display_name?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const competitor = await setCompetitor(cid, {
      enabled: body.enabled,
      schedule: body.schedule,
      display_name: body.display_name,
    });
    if (!competitor) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ competitor });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE /api/competitors/[id] — stop watching (delete the row).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    await removeCompetitor(cid);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
