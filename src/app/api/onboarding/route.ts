import { NextResponse, after } from 'next/server';
import { sql, jsonb } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { activateAndLaunchQuickMission } from '@/lib/activation';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// The activation kickoff runs in after(): it drafts the quick-mission brief (a Sonnet
// call) + creates the goal/mission before dispatching wave 0 to its own function.
// Give that after() room so the brief-draft can't be cut off mid-flight.
export const maxDuration = 60;

// Shape persisted into workspaces.business_profile (jsonb). It merges the chosen
// role + autonomy level with the free-form business profile collected in the wizard.
interface OnboardingBody {
  role?: string;
  autonomy?: string;
  businessProfile?: Record<string, unknown>;
}

// GET /api/onboarding → { onboarding_complete, business_profile } for the active
// workspace, so the wizard can prefill answers / skip itself if already done.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const rows = await sql()`
      SELECT onboarding_complete, business_profile
      FROM public.tenants
      WHERE id = ${tenantId()}
      LIMIT 1
    `;
    const row = rows[0] ?? {};
    return NextResponse.json({
      onboarding_complete: row.onboarding_complete ?? false,
      business_profile: row.business_profile ?? null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/onboarding → persist the collected wizard data onto the workspace row
// and mark onboarding complete.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  try {
    const body = (await request.json()) as OnboardingBody;
    const profile = {
      role: body.role ?? null,
      autonomy: body.autonomy ?? null,
      ...(body.businessProfile ?? {}),
    };
    await sql()`
      UPDATE public.tenants
      SET business_profile = ${jsonb(profile)},
          onboarding_complete = true
      WHERE id = ${tenantId()}
    `;

    // Kick off the 72-hour activation clock + auto-fire a first mission so
    // the user has drafts in /drafts within minutes. Idempotent — re-finishing
    // onboarding never re-starts the clock or re-fires a mission. Background
    // it via after() so the wizard's POST returns immediately.
    const agencyName = typeof (body.businessProfile?.businessName) === 'string'
      ? (body.businessProfile.businessName as string)
      : (typeof body.businessProfile?.name === 'string' ? body.businessProfile.name as string : undefined);
    const industry = typeof body.businessProfile?.industry === 'string'
      ? body.businessProfile.industry as string
      : undefined;
    after(async () => {
      try { await activateAndLaunchQuickMission({ agencyName, industry }); }
      catch (e) { console.error('[onboarding] activation kickoff failed:', (e as Error).message); }
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
