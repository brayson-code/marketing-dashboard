import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import {
  getCampaign,
  updateCampaign,
  deleteCampaign,
  listMissionsForCampaign,
  type CampaignStatus,
} from '@/lib/campaigns';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/campaigns/[id] — campaign detail + the missions belonging to it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  try {
    const campaign = await getCampaign(id);
    if (!campaign) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const missions = await listMissionsForCampaign(id);
    return NextResponse.json({ campaign, missions });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// PATCH /api/campaigns/[id] — partial update. Body keys are optional; pass null
// explicitly to clear goal_id / starts_at / ends_at.
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  let body: Partial<{
    name: string;
    goal_id: string | null;
    channels: string[];
    starts_at: string | null;
    ends_at: string | null;
    status: CampaignStatus;
    brief: string;
  }>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    const updated = await updateCampaign(id, body);
    if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, campaign: updated });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// DELETE /api/campaigns/[id] — hard delete the container. Missions keep their
// rows; their campaign_id will fall back to NULL via the FK / app code.
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;
  try {
    const ok = await deleteCampaign(id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
