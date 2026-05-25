import { NextResponse } from 'next/server';
import { getGene, updateGene, setGeneStatus, listGeneEvents, type GeneStatus } from '@/lib/genes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/genes/:id  → { gene, events }
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  const gene = await getGene(id);
  if (!gene) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const events = await listGeneEvents(id);
  return NextResponse.json({ gene, events });
}

// PATCH /api/genes/:id  → edit fields and/or change status
//   { title?, body?, agentId?, status?: 'active'|'proposed'|'retired' }
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
  try {
    const body = await request.json();
    let gene = await getGene(id);
    if (!gene) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    if (body.title !== undefined || body.body !== undefined || body.agentId !== undefined) {
      gene = await updateGene(id, { title: body.title, body: body.body, agentId: body.agentId });
    }
    if (body.status && ['active', 'proposed', 'retired'].includes(body.status)) {
      gene = await setGeneStatus(id, body.status as GeneStatus);
    }
    return NextResponse.json({ gene });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
