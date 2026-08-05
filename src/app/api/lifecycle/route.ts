// Workspace lifecycle — HQ only. Provision dark, open on day one, pause, offboard.
//
// This is the endpoint Brayson's provisioning console and KeyMatch will both call:
//   POST { action: 'provision', name, go_live_on }        → a dark workspace
//   POST { action: 'activate', tenant, emails: [...] }    → logins + sign-in links
//   POST { action: 'pause' | 'offboard' | 'resume', ... }
//
// It works standalone in the meantime, driven by hand from /portal-admin, so Client
// Success is not blocked waiting on either integration.
//
// requireHq() rather than the requireApi* role helpers: those are no-ops while
// AUTHZ_ENFORCE is 'off' (the default) and would gate nothing. Same precedent as
// /api/security/console and /api/templates.
//
// Every call is audit-logged. These actions decide whether a paying client can reach
// their workspace, so "who opened this and when" must be answerable later.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireHq } from '@/lib/hq-guard';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { listLifecycle, provisionWorkspace, transition, grantPrepAccess } from '@/lib/workspace-lifecycle';
import type { LifecycleAction } from '@/lib/workspace-lifecycle-catalog';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const ACTIONS = new Set(['activate', 'pause', 'resume', 'offboard']);

export async function GET() {
  enterTenant(await resolveTenant());
  const denied = requireHq();
  if (denied) return denied;

  try {
    return NextResponse.json({ workspaces: await listLifecycle() });
  } catch (err) {
    console.error('lifecycle GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  enterTenant(await resolveTenant());
  const denied = requireHq();
  if (denied) return denied;
  const actor = requireUser(request);

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');

    if (action === 'provision') {
      const name = String(body?.name ?? '').trim();
      if (!name) return NextResponse.json({ error: 'A workspace name is required' }, { status: 400 });
      const id = await provisionWorkspace({
        name,
        plan: body?.plan,
        goLiveOn: body?.go_live_on ?? null,
        by: actor?.username ?? null,
      });
      await logAudit({
        actor, action: 'workspace.provision', target: `tenant:${id}`,
        detail: { name, go_live_on: body?.go_live_on ?? null },
      });
      return NextResponse.json({ ok: true, tenant: id });
    }

    // Early assistant access. Deliberately NOT a state transition: the workspace stays
    // closed to the client, one more person can just read it.
    if (action === 'prep') {
      const tenant = String(body?.tenant ?? '').trim();
      const email = String(body?.email ?? '').trim();
      const until = String(body?.until ?? '').trim();
      if (!tenant || !email || !until) {
        return NextResponse.json({ error: 'tenant, email and until are required' }, { status: 400 });
      }
      const origin = request.headers.get('origin') || new URL(request.url).origin;
      const grant = await grantPrepAccess(tenant, email, until, origin);
      await logAudit({
        actor, action: 'workspace.prep_access', target: `tenant:${tenant}`,
        detail: { email, until, error: grant.error ?? null },
      });
      return NextResponse.json(
        { ok: !grant.error, grants: [grant], error: grant.error ?? null },
        { status: grant.error ? 409 : 200 },
      );
    }

    if (!ACTIONS.has(action)) {
      return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
    // Narrowed by the allow-list above, so the state machine never receives an
    // arbitrary client string.
    const lifecycleAction = action as LifecycleAction;

    const tenant = String(body?.tenant ?? '').trim();
    if (!tenant) return NextResponse.json({ error: 'tenant required' }, { status: 400 });

    // The origin is needed to build sign-in links that point back at this deployment
    // rather than at whatever host happens to be configured elsewhere.
    const origin = request.headers.get('origin') || new URL(request.url).origin;

    const result = await transition(tenant, lifecycleAction, {
      emails: Array.isArray(body?.emails) ? body.emails : [],
      origin,
      note: body?.note ?? null,
    });

    await logAudit({
      actor,
      action: `workspace.${action}`,
      target: `tenant:${tenant}`,
      detail: {
        ok: result.ok,
        status: result.status ?? null,
        granted: result.grants?.filter(g => !g.error).map(g => `${g.role}:${g.email}`) ?? [],
        failed: result.grants?.filter(g => g.error).map(g => `${g.email}: ${g.error}`) ?? [],
        revoked: result.revoked ?? 0,
        error: result.error ?? null,
      },
    });

    // A refused transition is a 409, not a 500 — the caller asked for something the
    // state machine does not allow, which is a different problem from a broken server.
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  } catch (err) {
    console.error('lifecycle POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
