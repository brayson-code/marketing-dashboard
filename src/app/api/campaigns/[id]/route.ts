import { NextRequest, NextResponse } from 'next/server';
import { getCampaignDetail } from '@/lib/waves';

export const dynamic = 'force-dynamic';

// GET /api/campaigns/:id — campaign + per-wave steps (the checkpoint state).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const detail = await getCampaignDetail(id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
