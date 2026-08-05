// Service Portal — HQ writes. requireHq() gated BEFORE anything runs.
//
// Two things live here and both are deliberately operator-only:
//   • a workspace's service profile (who their assistant is, start date, hours) — the
//     start date drives probation and every accrued-days figure, so a client editing
//     their own would be editing a contractual fact about their placement;
//   • global announcements/events, which publish to every workspace at once.
//
// requireHq is used rather than the requireApi* role helpers because those are no-ops
// while AUTHZ_ENFORCE is 'off' (the default) — they would gate nothing. Same precedent
// as /api/security/console and /api/templates.

import { NextRequest, NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { requireOperator } from '@/lib/operator-guard';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import {
  getServiceProfile, upsertServiceProfile,
  listAllAnnouncements, createAnnouncement, deleteAnnouncement,
} from '@/lib/service-portal';
import { listWorkspaces } from '@/lib/agent-library';
import { getCapture, saveCapture } from '@/lib/onboarding-capture';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  enterTenant(await resolveTenant());
  const denied = await requireOperator();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const target = searchParams.get('tenant');

  try {
    const [workspaces, announcements] = await Promise.all([
      listWorkspaces(),
      listAllAnnouncements(),
    ]);
    // The onboarding capture rides along with the profile read — same workspace, same
    // screen, one round trip.
    const [profile, capture] = target
      ? await Promise.all([getServiceProfile(target), getCapture(target)])
      : [null, null];
    return NextResponse.json({ workspaces, announcements, profile, capture });
  } catch (err) {
    console.error('portal admin GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  enterTenant(await resolveTenant());
  const denied = await requireOperator();
  if (denied) return denied;
  const actor = requireUser(request);

  try {
    const body = await request.json();
    const action = String(body?.action ?? '');

    if (action === 'profile') {
      const target = String(body?.tenant ?? '').trim();
      if (!target) return NextResponse.json({ error: 'tenant required' }, { status: 400 });
      await upsertServiceProfile(target, body.profile ?? {});
      await logAudit({
        actor, action: 'portal.profile.upsert', target: `tenant:${target}`,
        detail: { fields: Object.keys(body.profile ?? {}) },
      });
      return NextResponse.json({ ok: true });
    }

    if (action === 'capture') {
      const target = String(body?.tenant ?? '').trim();
      if (!target) return NextResponse.json({ error: 'tenant required' }, { status: 400 });
      const capture = await saveCapture(
        target,
        { founder: body?.founder ?? {}, playbook: body?.playbook ?? {} },
        actor?.username ?? null,
        new Date().toISOString(),
      );
      await logAudit({
        actor, action: 'portal.onboarding.capture', target: `tenant:${target}`,
        detail: { filled: capture.filled, total: capture.total },
      });
      return NextResponse.json({ ok: true, capture });
    }

    if (action === 'announce') {
      const id = await createAnnouncement({ ...(body.announcement ?? {}), created_by: actor ?? null });
      if (!id) return NextResponse.json({ error: 'title required' }, { status: 400 });
      await logAudit({
        actor, action: 'portal.announcement.create', target: `announcement:${id}`,
        detail: { title: body.announcement?.title, audience: body.announcement?.audience },
      });
      return NextResponse.json({ ok: true, id });
    }

    if (action === 'delete') {
      const id = String(body?.id ?? '').trim();
      if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
      await deleteAnnouncement(id);
      await logAudit({ actor, action: 'portal.announcement.delete', target: `announcement:${id}`, detail: {} });
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (err) {
    console.error('portal admin POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
