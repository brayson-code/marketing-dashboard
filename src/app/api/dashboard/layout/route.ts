import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getSubject } from '@/lib/authz';
import { currentUserId } from '@/lib/tenant';
import { resolveLayout, saveTenantLayout, saveUserLayout } from '@/lib/dashboard-layout';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/dashboard/layout → the resolved Overview layout for the active (tenant, user)
// plus where it came from. Tenant-scoped (enterTenant); any authed member sees their
// resolved board. `source` is one of user | tenant | industry | default.
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    const { layout, source } = await resolveLayout();
    return NextResponse.json({ layout, source });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// PUT /api/dashboard/layout { widgets: [{ id, span? }], scope: 'user' | 'tenant' }
//   • scope 'user'   → this teammate's personal board (any workspace member).
//   • scope 'tenant' → the workspace DEFAULT everyone inherits → OWNER only (mirrors
//     requireApiAdmin: 'owner' is the admin-equivalent role). Reversible config that
//     only reshapes THIS workspace's own overview, read-modify-write is tenant-scoped,
//     so a caller can never touch another workspace.
export async function PUT(request: Request) {
  enterTenant(await resolveTenant());

  const subject = await getSubject();
  if (!subject.isMember) {
    return NextResponse.json({ error: 'Not a member of this workspace' }, { status: 403 });
  }

  let body: { widgets?: unknown; scope?: unknown };
  try {
    body = (await request.json()) as { widgets?: unknown; scope?: unknown };
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { scope, widgets } = body;
  if (scope !== 'user' && scope !== 'tenant') {
    return NextResponse.json({ error: "scope must be 'user' or 'tenant'" }, { status: 400 });
  }
  if (!Array.isArray(widgets)) {
    return NextResponse.json({ error: 'widgets must be an array' }, { status: 400 });
  }

  try {
    if (scope === 'tenant') {
      if (subject.role !== 'owner') {
        return NextResponse.json(
          { error: 'Only an owner can set the workspace default layout' },
          { status: 403 },
        );
      }
      const layout = await saveTenantLayout(widgets);
      return NextResponse.json({ ok: true, source: 'tenant', layout });
    }

    // scope === 'user'
    const uid = currentUserId();
    if (!uid) return NextResponse.json({ error: 'No authenticated user' }, { status: 401 });
    const { layout, persisted } = await saveUserLayout(uid, widgets);
    return NextResponse.json({ ok: true, source: 'user', persisted, layout });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
