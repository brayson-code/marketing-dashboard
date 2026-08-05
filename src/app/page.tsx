import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getSubject } from '@/lib/authz';
import { resolveLayout } from '@/lib/dashboard-layout';
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
// LensTabs + the department state live inside <WidgetBoard> (a board-level control above
// the grid); every self-fetching widget already owns its own data.

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export default async function OverviewPage() {
  enterTenant(await resolveTenant());
  const [{ layout }, subject] = await Promise.all([resolveLayout(), getSubject()]);
  const canSetWorkspaceDefault = subject.role === 'owner';

  return (
    <div className="space-y-5">
      <OnboardingGate />
      {/* Role-aware, and renders nothing once the essentials are answered. Above the
          board because on day one it IS the thing to do. */}
      <FirstRunCard />
      <WidgetBoard initialLayout={layout} canSetWorkspaceDefault={canSetWorkspaceDefault} />
    </div>
  );
}
