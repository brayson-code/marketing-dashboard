import { NextResponse } from 'next/server';
import { listGenes, createGene, genesEnabled, setGenesEnabled, type GeneStatus } from '@/lib/genes';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/genes?status=active|proposed|retired  → { enabled, genes }
export async function GET(request: Request) {
  try {
    const status = new URL(request.url).searchParams.get('status') as GeneStatus | null;
    const [enabled, genes] = await Promise.all([
      genesEnabled(),
      listGenes(status ? { status } : {}),
    ]);
    return NextResponse.json({ enabled, genes });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/genes  → mint an owner-authored gene (born active)
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { title, body: text, role, agentId } = body ?? {};
    if (!title || !text || !role) {
      return NextResponse.json({ error: 'title, body and role are required' }, { status: 400 });
    }
    const gene = await createGene({ title, body: text, role, agentId: agentId ?? null, status: 'active', createdBy: 'owner' });
    if (!gene) return NextResponse.json({ error: 'A gene with that name already exists' }, { status: 409 });
    return NextResponse.json({ gene });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/genes  → toggle the global kill switch { enabled: boolean }
export async function PUT(request: Request) {
  try {
    const { enabled } = await request.json();
    await setGenesEnabled(!!enabled);
    return NextResponse.json({ ok: true, enabled: !!enabled });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
