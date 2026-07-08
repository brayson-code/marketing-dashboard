import { NextResponse, after } from 'next/server';
import { sql, jsonb } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { activateAndLaunchQuickMission } from '@/lib/activation';
import { getEnabledViews, TOGGLEABLE_HREFS, isViewOn } from '@/lib/command-center-views';

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

// What the wizard needs to know about a tenant that was already stood up by
// scripts/provision-demo-client.ts (or any future intake that fills business_profile
// the same way) BEFORE onboarding ever ran. Real invited clients (src/app/api/clients)
// start with an EMPTY business_profile, so `provisioned` is false for them and every
// field below is a zeroed default — the wizard renders exactly as it always has.
interface OnboardingProvisioning {
  provisioned: boolean;
  industry: string | null;
  hasPlaybook: boolean;
  playbookPreview: string | null;
  agentCount: number;
  viewsConfigured: boolean;
  viewsOnCount: number;
  viewsTotalCount: number;
}

// Detect provisioning per the diagnosis: industry + playbook both set (a real niche
// brief was written for this tenant), and/or the demo markers `provision-demo-client.ts`
// stamps via mergeBusinessProfile. Either signal alone is enough — a future non-demo
// intake that only sets industry+playbook should still count as "provisioned".
function detectProvisioning(bp: Record<string, unknown> | null): {
  provisioned: boolean;
  industry: string | null;
  playbook: string | null;
} {
  const industry = typeof bp?.industry === 'string' && bp.industry.trim() ? bp.industry.trim() : null;
  const playbook = typeof bp?.playbook === 'string' && bp.playbook.trim() ? bp.playbook.trim() : null;
  const isDemo = bp?.demo === true || (typeof bp?.demo_slug === 'string' && bp.demo_slug.trim().length > 0);
  return { provisioned: isDemo || (industry != null && playbook != null), industry, playbook };
}

// A short, human preview of the provisioned company brief (strip the leading H1 so
// it reads as a sentence, not a heading) — just enough for the wizard to show "we
// already have this" without dumping the whole markdown doc into the UI.
function previewPlaybook(md: string): string {
  const body = md.replace(/^#[^\n]*\n+/, '').trim();
  const snippet = (body || md).replace(/\s+/g, ' ').trim();
  return snippet.length > 220 ? `${snippet.slice(0, 220).trim()}…` : snippet;
}

// GET /api/onboarding → { onboarding_complete, business_profile, provisioning } for
// the active workspace, so the wizard can prefill answers / skip itself if already
// done / recognize a pre-provisioned tenant and stop asking for what it already knows.
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
    const bp = (row.business_profile ?? null) as Record<string, unknown> | null;
    const { provisioned, industry, playbook } = detectProvisioning(bp);

    let provisioning: OnboardingProvisioning = {
      provisioned: false,
      industry: null,
      hasPlaybook: false,
      playbookPreview: null,
      agentCount: 0,
      viewsConfigured: false,
      viewsOnCount: 0,
      viewsTotalCount: TOGGLEABLE_HREFS.length,
    };

    if (provisioned) {
      // Only run the extra reads when there's actually something provisioned to
      // report — keeps the common (non-provisioned) path a single-row select.
      const agentRows = (await sql()`
        SELECT count(*)::int AS n FROM public.agent_defs
        WHERE tenant_id = ${tenantId()} AND source = 'custom'
      `) as unknown as Array<{ n: number }>;
      const enabledViews = await getEnabledViews();
      const viewsConfigured = Object.keys(enabledViews).length > 0;
      provisioning = {
        provisioned: true,
        industry,
        hasPlaybook: playbook != null,
        playbookPreview: playbook ? previewPlaybook(playbook) : null,
        agentCount: agentRows[0]?.n ?? 0,
        viewsConfigured,
        viewsOnCount: TOGGLEABLE_HREFS.filter((href) => isViewOn(enabledViews, href)).length,
        viewsTotalCount: TOGGLEABLE_HREFS.length,
      };
    }

    return NextResponse.json({
      onboarding_complete: row.onboarding_complete ?? false,
      business_profile: bp,
      provisioning,
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
    // MERGE, don't replace: a provisioned tenant (Key Matrix intake / demo preset) may
    // already carry business_profile.{industry,playbook,playbook_answers,demo,demo_slug,
    // command_center_views} written before onboarding ever ran. Overwriting the whole
    // column here would silently wipe all of that the moment the wizard finishes.
    await sql()`
      UPDATE public.tenants
      SET business_profile = COALESCE(business_profile, '{}'::jsonb) || ${jsonb(profile)},
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
