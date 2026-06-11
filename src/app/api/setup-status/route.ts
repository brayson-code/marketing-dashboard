import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/setup-status — one consolidated, live read of "how set up is this
// workspace?" for the post-onboarding walkthrough. Every flag is DERIVED from the
// real domain tables (no separate "step done" bookkeeping to drift), so a step's
// coaching tip retires the instant the underlying action is actually done.
//
// Also returns the caller's REAL membership role (owner/member/va) so the client
// can gate the setup checklist to owners — /api/auth/me currently hardcodes
// 'admin' (V1 stub), this reads workspace_members.role for the current user.
//
// Backend runs as the postgres role (bypasses RLS), so every subquery scopes to
// tenantId() explicitly.
export async function GET() {
  enterTenant(await resolveTenant());
  const tid = tenantId();
  const uid = currentUserId();

  // Require an authenticated user. Without this, an anonymous request falls back to
  // the DEFAULT (HQ) tenant and would leak its setup signals. (resolveTenant swallows
  // auth errors and defaults the tenant, so the handler must guard explicitly.)
  if (!uid) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const rows = (await sql()`
      SELECT
        (SELECT role FROM public.workspace_members
           WHERE workspace_id = ${tid} AND user_id = ${uid}) AS role,
        (SELECT onboarding_complete FROM public.tenants WHERE id = ${tid}) AS onboarding_complete,
        (SELECT plan FROM public.tenants WHERE id = ${tid}) AS plan,
        EXISTS(SELECT 1 FROM public.client_integrations
           WHERE tenant_id = ${tid} AND provider = 'anthropic' AND status = 'configured') AS claude_key,
        EXISTS(SELECT 1 FROM public.cron_jobs
           WHERE tenant_id = ${tid}
             AND agent_id IN ('ai-ceo','ai-cmo','ai-coo','ai-cro','ai-cxo')
             AND enabled = true AND next_run_at IS NOT NULL) AS execs_enabled,
        EXISTS(SELECT 1 FROM public.goals WHERE tenant_id = ${tid}) AS goals,
        (SELECT COALESCE(length(trim(business_profile->>'playbook')) > 0, false)
           FROM public.tenants WHERE id = ${tid}) AS playbook,
        EXISTS(SELECT 1 FROM public.connections
           WHERE tenant_id = ${tid} AND status = 'connected') AS socials,
        EXISTS(SELECT 1 FROM public.client_integrations
           WHERE tenant_id = ${tid} AND status = 'configured'
             AND provider IN ('ga4','plausible','gmail','google_calendar','agentmail','mailchimp')) AS integrations,
        EXISTS(SELECT 1 FROM public.cron_jobs
           WHERE tenant_id = ${tid} AND id = 'competitor-watch'
             AND enabled = true) AS competitor_watch,
        COALESCE((SELECT jsonb_array_length(business_profile->'invites')
           FROM public.tenants
           WHERE id = ${tid} AND jsonb_typeof(business_profile->'invites') = 'array'), 0) AS invite_count,
        EXISTS(SELECT 1 FROM public.workspace_members
           WHERE workspace_id = ${tid} AND user_id <> ${uid}) AS other_members
    `) as unknown as Array<{
      role: string | null;
      onboarding_complete: boolean | null;
      plan: string | null;
      claude_key: boolean;
      execs_enabled: boolean;
      goals: boolean;
      playbook: boolean;
      socials: boolean;
      integrations: boolean;
      competitor_watch: boolean;
      invite_count: number;
      other_members: boolean;
    }>;

    const r = rows[0];
    const plan = r?.plan ?? 'free';

    return NextResponse.json({
      role: r?.role ?? null,
      onboarding_complete: r?.onboarding_complete ?? false,
      plan,
      signals: {
        plan_set: plan !== 'free',
        claude_key: !!r?.claude_key,
        execs_enabled: !!r?.execs_enabled,
        goals: !!r?.goals,
        playbook: !!r?.playbook,
        socials: !!r?.socials,
        integrations: !!r?.integrations,
        competitor_watch: !!r?.competitor_watch,
        teammate: (r?.invite_count ?? 0) > 0 || !!r?.other_members,
      },
    });
  } catch (error) {
    console.error('[setup-status]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
