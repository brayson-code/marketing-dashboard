import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getCanvas, saveCanvas, type CanvasNode, type CanvasEdge } from '@/lib/generation-canvas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET   /api/generation/canvas/:id            → { canvas }
// PATCH /api/generation/canvas/:id {nodes,edges,viewport,title} → { ok }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const canvas = await getCanvas(cid);
  if (!canvas) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ canvas });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  const cid = Number(id);
  if (!Number.isFinite(cid)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  let body: { title?: string; nodes?: CanvasNode[]; edges?: CanvasEdge[]; viewport?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    await saveCanvas(cid, { title: body.title, nodes: body.nodes, edges: body.edges, viewport: body.viewport });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
