import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { listCampaigns, createCampaign, updateCampaign } from '@/lib/campaigns';
import { draftCampaignGoal } from '@/lib/campaign-intake';
import { createGoal } from '@/lib/goals';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60; // the auto-goal draft is one cheap LLM call

// GET /api/campaigns — list campaigns (newest updated first) with rolled-up
// mission stats joined from public.wave_runs.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json({ campaigns: await listCampaigns() });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}

// POST /api/campaigns — create a new campaign container.
// Body: { action: 'create', name, goal_id?, channels?, starts_at?, ends_at?, brief? }
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: {
    action?: string;
    name?: string;
    goal_id?: string | null;
    channels?: string[];
    starts_at?: string | null;
    ends_at?: string | null;
    brief?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (body.action === 'create') {
    if (!body.name || !body.name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    try {
      const c = await createCampaign({
        name: body.name.trim(),
        goal_id: body.goal_id ?? null,
        channels: Array.isArray(body.channels) ? body.channels : [],
        starts_at: body.starts_at ?? null,
        ends_at: body.ends_at ?? null,
        brief: body.brief ?? '',
      });

      // Auto-spawn a North Star goal when the owner didn't link one. Best-effort:
      // if drafting fails (no API key, LLM error), the campaign still exists
      // without a goal — the owner can attach one later. The goal is owned by
      // the AI CMO (campaigns are marketing-led) so it surfaces on that hero card
      // and the goal-observer loop attaches to it.
      let campaign = c;
      if (!body.goal_id) {
        try {
          const drafted = await draftCampaignGoal({ name: c.name, brief: c.brief, channels: c.channels });
          if (drafted) {
            const goal = await createGoal({
              title: drafted.title,
              success: drafted.success,
              due: drafted.due,
              owner: 'owner',
              metadata: { owner_agent: 'ai-cmo', is_campaign_goal: true, campaign_id: c.id, source: 'campaign' },
            });
            const updated = await updateCampaign(c.id, { goal_id: goal.id });
            if (updated) campaign = updated;
          }
        } catch (e) {
          console.error('[campaigns] auto-goal failed:', (e as Error).message);
        }
      }

      return NextResponse.json({ ok: true, campaign });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  return NextResponse.json({ error: 'Unknown action. Use: create' }, { status: 400 });
}
