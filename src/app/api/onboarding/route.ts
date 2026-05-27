import { NextResponse } from 'next/server';
import { sql, jsonb } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

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
  try {
    const rows = await sql()`
      SELECT onboarding_complete, business_profile
      FROM public.workspaces
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
  try {
    const body = (await request.json()) as OnboardingBody;
    const profile = {
      role: body.role ?? null,
      autonomy: body.autonomy ?? null,
      ...(body.businessProfile ?? {}),
    };
    await sql()`
      UPDATE public.workspaces
      SET business_profile = ${jsonb(profile)},
          onboarding_complete = true,
          updated_at = now()
      WHERE id = ${tenantId()}
    `;
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
