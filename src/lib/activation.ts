// 72-hour activation clock + quick-win checklist. The instant a tenant
// finishes onboarding, we stamp `activation_started_at` AND auto-fire a
// research-analyst → content-writer mission so they have drafts to approve
// within minutes. Nothing here mutates schema — milestones are computed
// from existing tables (connections, goals, agent_tasks, agent_drafts).
//
// Design intent: a countdown without an action is just pressure. Pair the
// clock with an automatic mission and the user sees a tangible artifact
// (drafts in /drafts) before they've had time to wonder if it works.

import { sql, tenantId } from './db/client';

export interface MilestoneDef {
  key: 'connect_channel' | 'set_north_star' | 'first_mission' | 'first_approval' | 'first_publish';
  label: string;
  description: string;
  cta_label: string;
  cta_href: string;
}

export const MILESTONES: MilestoneDef[] = [
  { key: 'connect_channel', label: 'Connect a channel',         description: 'Plug in YouTube, Instagram, LinkedIn, or another channel so agents have something to read + write to.', cta_label: 'Connect',          cta_href: '/connections' },
  { key: 'set_north_star',  label: 'Set your North Star',       description: 'One goal that defines what your AI team is driving toward.',                                            cta_label: 'Set goal',         cta_href: '/goals' },
  { key: 'first_mission',   label: 'Launch your first mission', description: 'Spawn a multi-agent run to research + draft for you.',                                                  cta_label: 'Open Missions',    cta_href: '/missions' },
  { key: 'first_approval',  label: 'Approve your first draft',  description: 'Mark an agent-produced post or reply as ready to publish.',                                              cta_label: 'Open Drafts',      cta_href: '/drafts' },
  { key: 'first_publish',   label: 'Publish your first draft',  description: 'A draft goes live through a connected channel. The value moment.',                                       cta_label: 'Open Drafts',      cta_href: '/drafts' },
];

export interface MilestoneState extends MilestoneDef {
  done: boolean;
  done_at: string | null; // ISO
}

export interface ActivationState {
  /** Activation has been kicked off (wizard done). When false, the rest is for preview only. */
  started: boolean;
  started_at: string | null;       // ISO
  deadline_at: string | null;      // ISO (started + 72hr)
  /** Seconds remaining until deadline. Negative when overdue. */
  seconds_remaining: number | null;
  milestones: MilestoneState[];
  completed_count: number;
  total: number;
  /** Activation is "won" the moment first_publish lands or all 5 are done. */
  activated: boolean;
  quick_mission_id: string | null;
}

const WINDOW_SECONDS = 72 * 60 * 60;

/** Read the activation state for the current tenant. Computes milestones live
 *  from existing tables so we don't have to manually mark anything. */
export async function getActivationState(): Promise<ActivationState> {
  // 1) Clock + auto-fired mission id.
  const clockRows = (await sql()`
    SELECT activation_started_at, activation_quick_mission_id
    FROM public.tenants
    WHERE id = ${tenantId()}
    LIMIT 1
  `) as unknown as Array<{ activation_started_at: Date | null; activation_quick_mission_id: string | null }>;
  const startedAt = clockRows[0]?.activation_started_at ?? null;
  const quickMission = clockRows[0]?.activation_quick_mission_id ?? null;

  // 2) Milestone derivation. One SELECT per milestone, all best-effort —
  //    a missing table never breaks the checklist.
  const milestones: MilestoneState[] = await Promise.all(MILESTONES.map(async (m) => {
    const at = await firstMilestoneTimestamp(m.key);
    return { ...m, done: at !== null, done_at: at };
  }));

  const completed = milestones.filter((m) => m.done).length;
  const startedIso = startedAt ? new Date(startedAt).toISOString() : null;
  const deadlineMs = startedAt ? new Date(startedAt).getTime() + WINDOW_SECONDS * 1000 : null;
  const deadlineIso = deadlineMs ? new Date(deadlineMs).toISOString() : null;
  const secondsRemaining = deadlineMs ? Math.round((deadlineMs - Date.now()) / 1000) : null;
  // Activated when first_publish lands OR all 5 are checked.
  const activated = milestones.find((m) => m.key === 'first_publish')?.done === true
                 || completed >= MILESTONES.length;

  return {
    started: startedAt !== null,
    started_at: startedIso,
    deadline_at: deadlineIso,
    seconds_remaining: secondsRemaining,
    milestones,
    completed_count: completed,
    total: MILESTONES.length,
    activated,
    quick_mission_id: quickMission,
  };
}

/** Best-effort lookup of when a milestone first happened for this tenant.
 *  Returns ISO timestamp or null. Each branch is wrapped in try/catch so
 *  schema drift doesn't crash the API — checklist degrades gracefully. */
async function firstMilestoneTimestamp(key: MilestoneDef['key']): Promise<string | null> {
  try {
    if (key === 'connect_channel') {
      const rows = (await sql()`
        SELECT MIN(connected_at) AS at
        FROM public.connections
        WHERE tenant_id = ${tenantId()} AND status = 'connected'
      `) as unknown as Array<{ at: Date | null }>;
      return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
    }
    if (key === 'set_north_star') {
      const rows = (await sql()`
        SELECT MIN(created_at) AS at
        FROM public.goals
        WHERE tenant_id = ${tenantId()} AND (metadata->>'is_north_star')::bool = true
      `) as unknown as Array<{ at: Date | null }>;
      return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
    }
    if (key === 'first_mission') {
      // A "mission" here = the user (or auto-fire) launching a wave_run.
      const rows = (await sql()`
        SELECT MIN(created_at) AS at FROM public.wave_runs WHERE tenant_id = ${tenantId()}
      `) as unknown as Array<{ at: Date | null }>;
      return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
    }
    if (key === 'first_approval') {
      const rows = (await sql()`
        SELECT MIN(reviewed_at) AS at
        FROM public.agent_drafts
        WHERE tenant_id = ${tenantId()} AND status IN ('approved','published','sent','confirmed')
      `) as unknown as Array<{ at: Date | null }>;
      return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
    }
    if (key === 'first_publish') {
      const rows = (await sql()`
        SELECT MIN(executed_at) AS at
        FROM public.agent_drafts
        WHERE tenant_id = ${tenantId()} AND status IN ('published','sent','confirmed')
      `) as unknown as Array<{ at: Date | null }>;
      return rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
    }
  } catch (e) {
    console.error(`[activation] milestone lookup failed (${key}):`, (e as Error).message);
  }
  return null;
}

/** Kick off the 72-hour clock. Idempotent — won't reset an already-started
 *  tenant. Returns whether the clock was actually started by this call. */
export async function startActivation(): Promise<boolean> {
  const rows = (await sql()`
    UPDATE public.tenants
    SET activation_started_at = now()
    WHERE id = ${tenantId()} AND activation_started_at IS NULL
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Record the auto-fired quick-win mission id so the UI can deep-link it.
 *  Safe to call multiple times — only sets when currently null. */
export async function recordQuickMission(missionId: string): Promise<void> {
  await sql()`
    UPDATE public.tenants
    SET activation_quick_mission_id = ${missionId}
    WHERE id = ${tenantId()} AND activation_quick_mission_id IS NULL
  `;
}

/** Kick off the clock + auto-fire a default mission so the user has drafts
 *  in /drafts within minutes. Called from /api/onboarding when the wizard
 *  completes. Best-effort: if mission spawn fails the clock still starts. */
export async function activateAndLaunchQuickMission(opts: { agencyName?: string; industry?: string }): Promise<{ started: boolean; missionId: string | null }> {
  const started = await startActivation();
  if (!started) {
    // Already activated — never re-fire a mission for an existing tenant.
    return { started: false, missionId: null };
  }
  try {
    // Lazy import to avoid pulling the heavy intake stack in unrelated code paths.
    const { launchResearchCampaign } = await import('./campaign-intake');
    const { dispatchMissionAdvance } = await import('./waves');
    const industry = (opts.industry ?? '').trim();
    const agency = (opts.agencyName ?? '').trim();
    const brief = [
      `Draft 3 short LinkedIn posts introducing ${agency || 'this agency'} to its audience.`,
      industry ? `Industry: ${industry}.` : '',
      `Each post: under 280 characters, distinct angle, no emoji unless natural, no hashtag stuffing.`,
      `Then write 1 short outreach email (under 90 words) to send to a warm prospect, inviting them to a 15-minute call.`,
      `This is the user's first agent run — your output will be reviewed in /drafts. Keep it sharp, specific, and copy-ready so they can approve and publish today.`,
    ].filter(Boolean).join(' ');
    const launched = await launchResearchCampaign(brief);
    await recordQuickMission(launched.id);
    // Dispatch wave 0 into its OWN tenant-tagged 300s function via /api/cron/advance
    // (dispatchMissionAdvance carries tenantId() in the body). We must NOT run the
    // chain as a detached inline promise here: Fluid Compute freezes un-after()'d
    // promises once the onboarding response settles, which is exactly why the quick
    // mission used to stall at wave 0 with a single 'running' step and no output.
    dispatchMissionAdvance(launched.id);
    return { started: true, missionId: launched.id };
  } catch (e) {
    console.error('[activation] quick mission failed:', (e as Error).message);
    return { started: true, missionId: null };
  }
}
