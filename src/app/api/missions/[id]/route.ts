import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextRequest, NextResponse } from 'next/server';
import { getMissionDetail } from '@/lib/waves';

export const dynamic = 'force-dynamic';

// GET /api/missions/:id — mission + per-wave steps (the checkpoint state).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  try {
    const detail = await getMissionDetail(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
