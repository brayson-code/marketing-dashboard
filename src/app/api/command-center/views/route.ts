import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getSubject } from '@/lib/authz';
import {
  VIEW_SECTIONS,
  PRESETS,
  TOGGLEABLE_HREFS,
  getEnabledViews,
  setEnabledViews,
} from '@/lib/command-center-views';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const TOGGLEABLE_SET = new Set<string>(TOGGLEABLE_HREFS);

// GET /api/command-center/views → the catalog the Settings panel renders, plus this
// tenant's current enabled map and the named presets. Tenant-scoped (enterTenant);
// any authed member of the workspace may READ which views are on.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const enabled = await getEnabledViews();
    return NextResponse.json({ views: VIEW_SECTIONS, enabled, presets: PRESETS });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PATCH /api/command-center/views { enabled?, preset? } → apply a preset and/or a
// partial enabled patch, then return the merged map. This is REVERSIBLE config (not
// detrimental — it can only hide/show the tenant's OWN nav), so ANY workspace member is
// allowed — including a VA, since VAs build out a client's Command Center during
// onboarding. We require a real membership row (a stale/unprovisioned claim is rejected),
// and the read-modify-write is tenant-scoped, so a caller can only reshape their OWN
// workspace's nav.
//
// Order: if a preset is named it is applied first (as the base), then any explicit
// `enabled` patch is layered on top so callers can tweak a preset in one request.
export async function PATCH(request: Request) {
  enterTenant(await resolveTenant());
  const subject = await getSubject();
  if (!subject.isMember) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      enabled?: Record<string, unknown>;
      preset?: string;
    };

    const patch: Record<string, boolean> = {};

    if (body.preset !== undefined) {
      const preset = PRESETS[body.preset];
      if (!preset) {
        return NextResponse.json(
          { error: `Unknown preset: ${body.preset}` },
          { status: 400 },
        );
      }
      // A preset is a complete map; start every toggleable view ON, then apply the
      // preset's OFFs so switching presets fully resets prior overrides.
      for (const href of TOGGLEABLE_HREFS) patch[href] = true;
      for (const [href, on] of Object.entries(preset)) patch[href] = Boolean(on);
    }

    if (body.enabled !== undefined) {
      if (typeof body.enabled !== 'object' || body.enabled === null) {
        return NextResponse.json({ error: 'enabled must be an object' }, { status: 400 });
      }
      for (const [href, on] of Object.entries(body.enabled)) {
        // setEnabledViews() also validates, but reject unknown keys early with a 400
        // so a bad request is visible rather than silently dropped.
        if (TOGGLEABLE_SET.has(href)) patch[href] = Boolean(on);
      }
    }

    const enabled = await setEnabledViews(patch);
    return NextResponse.json({ enabled });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
