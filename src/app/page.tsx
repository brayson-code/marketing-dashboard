import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getSubject } from '@/lib/authz';
import { resolveLayout } from '@/lib/dashboard-layout';
import { getFounderProfile } from '@/lib/founder-profile';
import { sql } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';
import { firstRunCard, type Viewer } from '@/lib/first-run';
import OnboardingGate from '@/components/onboarding/onboarding-gate';
import { WidgetBoard } from '@/components/dashboard/widget-board';
import { FirstRunCard } from '@/components/home/first-run-card';

// The Overview is now a customizable widget board ("Lobsterboard").
//
// SERVER component: it resolves the board per-request, tenant-scoped, and hands the
// already-resolved layout to the client <WidgetBoard>. Resolution (Builder A,
// @/lib/dashboard-layout.resolveLayout) applies the precedence user-override →
// tenant-default → industry-template → today's-default. For a tenant with no saved
// layout and no industry template, it returns the today's-default template, so the
// board is visually identical to the pre-board Overview — zero change until someone
// customizes.
//
// The tenant/subject wiring mirrors the layout API route exactly:
// enterTenant(await resolveTenant()) first (resolveLayout + getSubject both read the
// per-request ALS context), then getSubject().role === 'owner' gates the "Set as
// workspace default" (scope 'tenant') control. The PUT route re-checks owner-only for
// that scope server-side, so this flag is UI-affordance only.
//
// ⚠️ EVERYTHING TENANT-SCOPED IS RESOLVED HERE, IN THE PAGE BODY, and passed down as
// props. enterTenant() puts the tenant in AsyncLocalStorage and a CHILD server component
// renders outside that scope, so a child calling tenantId() silently gets
// DEFAULT_TENANT_ID (HQ) and a child calling getSubject() silently gets the
// least-privilege subject. NEITHER THROWS. The first-run card was written that way and
// would have shown HQ's founder profile to every client.
//
// LensTabs + the department state live inside <WidgetBoard> (a board-level control above
// the grid); every self-fetching widget already owns its own data.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function OverviewPage() {
  enterTenant(await resolveTenant());
  const [{ layout }, subject, profile] = await Promise.all([
    resolveLayout(),
    getSubject(),
    getFounderProfile(),
  ]);
  const canSetWorkspaceDefault = subject.role === 'owner';

  // Did Client Success fill this in on the onboarding call? Turns the client's card from
  // "set this up" into "check what we wrote".
  let captured = false;
  try {
    const rows = (await sql()`
      SELECT business_profile -> 'onboarding_capture' AS c
      FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ c: { at?: string } | null }>;
    captured = typeof rows[0]?.c?.at === 'string';
  } catch { /* falls back to the cold copy, which is still correct */ }

  const answers = profile.answers ?? {};
  // Only a REAL member can be the assistant. getSubject() returns role 'va' as its
  // fail-closed default for anyone WITHOUT a membership row, so trusting the role alone
  // showed the assistant's card to operators and anyone mid-provisioning.
  const viewer: Viewer = subject.isMember ? (subject.role as Viewer) : 'owner';

  const card = firstRunCard({
    viewer,
    answers,
    captured,
    founderName: (answers as Record<string, string>).name ?? null,
  });

  return (
    <div className="space-y-5">
      <OnboardingGate />
      {/* Role-aware, and renders nothing once the essentials are answered. Above the
          board because on day one it IS the thing to do. */}
      <FirstRunCard card={card} />
      <WidgetBoard initialLayout={layout} canSetWorkspaceDefault={canSetWorkspaceDefault} />
    </div>
  );
}
