import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse, after } from 'next/server';
import { listMissions, runAndChain } from '@/lib/waves';
import { launchCampaign, previewCampaignPlan } from '@/lib/campaign-intake';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // kickoff runs wave 1 in the background via after()

// GET /api/missions — list missions (newest first).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ missions: await listMissions() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/missions — generalizes any objective into a wave plan.
//   { action: 'plan', request }                  → PREVIEW: drafts the brief +
//        composes the wave plan and returns it WITHOUT launching (no goal/mission
//        created). Lets the owner see the planned waves + agents before committing.
//   { request, campaign_id? }                     → LAUNCH: intake brief + goal +
//        composed plan → mission; wave 1 starts in the background. The launch
//        response also carries the composed `plan` so the UI can render it.
// When `campaign_id` is supplied the new mission is tagged to that Campaign
// container so it rolls up under it on /campaigns/[id].
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  const body = await request.json().catch(() => ({}));
  const req = typeof body?.request === 'string' ? body.request : '';
  const campaignId = typeof body?.campaign_id === 'string' && body.campaign_id.trim()
    ? body.campaign_id.trim()
    : null;

  // Plan-preview: compose and return the plan without launching anything.
  if (body?.action === 'plan') {
    try {
      const preview = await previewCampaignPlan(req);
      return NextResponse.json(preview);
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 400 });
    }
  }

  try {
    const launched = await launchCampaign(req, { campaignId });
    after(async () => {
      try {
        await runAndChain(launched.id); // wave 1 now; the rest auto-advance to completion
      } catch (err) {
        console.error(`[missions] wave 1 of ${launched.id} failed:`, (err as Error).message);
      }
    });
    return NextResponse.json({ ...launched, campaign_id: campaignId, dispatched: 'auto-advance' }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 400 });
  }
}
