// Automated cadence dispatcher — turns owner-APPROVED sequence steps into actually
// sent follow-up emails at their scheduled time.
//
// SAFETY MODEL (this engine only ever DELIVERS content the owner already approved):
//   - It NEVER generates or sends unapproved content. The only rows it touches are
//     sequences with status='approved' (the owner approved the body in the CRM) whose
//     scheduled_for has passed and that haven't been sent yet.
//   - It ships INERT. Two independent kill switches must BOTH be on for anything to send:
//       1. GLOBAL: env CADENCE_DISPATCH_ENABLED === 'true' (default OFF — Brayson flips
//          this once, platform-wide, when ready).
//       2. PER-TENANT: tenants.business_profile.cadence_enabled === true (each client
//          opts in for themselves).
//     When either is off, dispatchDueCadence() does nothing and returns {disabled:true}.
//
// MULTI-TENANT: the cron runs system-wide (outside any tenant context). We select the
// tenants that have opted in, then run the per-tenant send pass INSIDE that tenant's
// context via runWithTenant — the same sweep pattern as cron-runner.runDueJobs(), so
// the per-tenant AgentMail key + tenant_id scoping resolve correctly.
//
// IDEMPOTENCY / CONCURRENCY: we CLAIM due rows with a single atomic
// `UPDATE ... SET status='sent', sent_at=now() WHERE status='approved' AND ... RETURNING`
// so two overlapping cron runs can never claim the same row. We only attempt to send the
// rows we actually claimed; if a send fails we revert that one row to 'approved'
// (sent_at=NULL) so it retries next tick — a failed step is never left marked 'sent'.

import { sql, tenantId } from './db/client';
import { runWithTenant } from './tenant';
import { getAgentMailKey, sendEmail, type AmInbox } from './agentmail';

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Max steps sent per invocation (across all tenants) so one cron run stays well
 *  under the function time/memory limit. */
export const CADENCE_BATCH_LIMIT = 50;

/** Lead statuses that are eligible to receive an automated follow-up. A lead must
 *  be at least approved + in an active outreach stage. Terminal/closed stages
 *  (booked, qualified, rejected, disqualified) and not-yet-approved stages (new,
 *  validated) are intentionally excluded — we never auto-email those. */
export const OUTREACH_ELIGIBLE_STATUSES: ReadonlySet<string> = new Set([
  'approved',
  'contacted',
  'replied',
  'interested',
]);

/** Default gap to the next follow-up when advancing a lead's next_action_at and no
 *  per-sequence interval is known (days). */
const DEFAULT_CADENCE_INTERVAL_DAYS = 3;

// ── Pure eligibility helper (unit-tested) ────────────────────────────────────

/** Minimal shape the eligibility check needs from a lead row. */
export interface EligibilityLead {
  email: string | null;
  status: string | null;
  // DB stores BOOL; some call sites carry it as 0/1 — accept both.
  /** Postgres BOOLEAN. Was typed `boolean | number` while the app disagreed with
   *  the column; the truthy checks below no longer need to straddle both. */
  pause_outreach: boolean | null;
}

/** Minimal shape the eligibility check needs from a sequence step row. */
export interface EligibilityStep {
  status: string | null;
}

export type EligibilityResult =
  | 'send'
  | 'skip:disabled'
  | 'skip:not_approved'
  | 'skip:paused'
  | 'skip:no_email'
  | 'skip:ineligible_status'
  | 'skip:no_inbox';

/**
 * Decide whether a single approved step should be sent. Pure + side-effect free so
 * it can be exhaustively unit-tested. Order of checks is deliberate: the two kill
 * switches first (cheapest + most important), then content safety (only 'approved'
 * steps), then per-lead gates.
 */
export function eligibility(
  lead: EligibilityLead,
  step: EligibilityStep,
  hasInbox: boolean,
  envOn: boolean,
  tenantOn: boolean,
): EligibilityResult {
  // Kill switches — either off → the engine is inert.
  if (!envOn || !tenantOn) return 'skip:disabled';

  // Content safety: ONLY ever deliver steps the owner explicitly approved.
  if (step.status !== 'approved') return 'skip:not_approved';

  // No usable sending inbox/key for this tenant → can't send.
  if (!hasInbox) return 'skip:no_inbox';

  // Per-lead gates.
  if (lead.pause_outreach) return 'skip:paused';
  if (!lead.email || !lead.email.trim()) return 'skip:no_email';
  if (!lead.status || !OUTREACH_ELIGIBLE_STATUSES.has(lead.status)) return 'skip:ineligible_status';

  return 'send';
}

// ── Result types ─────────────────────────────────────────────────────────────

export interface CadenceSummary {
  sent: number;
  skipped: number;
  failed?: number;
  disabled?: boolean;
  tenants?: number;
  skips?: Record<string, number>;
}

// ── DB row shapes ────────────────────────────────────────────────────────────

interface DueRow {
  id: string;
  lead_id: string;
  step: number | null;
  subject: string | null;
  body: string | null;
  sequence_name: string | null;
  // joined lead fields
  email: string | null;
  lead_status: string | null;
  pause_outreach: boolean | null;
  first_name: string | null;
  last_name: string | null;
}

// ── Gating helpers ───────────────────────────────────────────────────────────

/** Global kill switch (env, default OFF). */
function globalEnabled(): boolean {
  return process.env.CADENCE_DISPATCH_ENABLED === 'true';
}

/** Tenant ids that have opted into automated cadence (business_profile.cadence_enabled === true).
 *  Runs OUTSIDE tenant context — the backend role bypasses RLS, so this legitimately
 *  sees every tenant's flag. */
async function optedInTenants(): Promise<string[]> {
  const rows = (await sql()`
    SELECT id::text AS id
    FROM public.tenants
    WHERE (business_profile->>'cadence_enabled') = 'true'
  `) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** The current tenant's opt-in flag — re-checked inside tenant context as a belt-and-
 *  suspenders guard against a tenant being toggled off mid-sweep. */
async function tenantEnabled(): Promise<boolean> {
  const rows = (await sql()`
    SELECT (business_profile->>'cadence_enabled') = 'true' AS on
    FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ on: boolean | null }>;
  return rows[0]?.on === true;
}

/** Resolve the tenant's sending inbox address (AgentMail inbox_id IS the address).
 *  Prefer the stored mapping; fall back to a live listInboxes(). Null when none. */
async function resolveSendingInbox(): Promise<string | null> {
  // Stored mapping first (cheap, no external call).
  try {
    const rows = (await sql()`
      SELECT account_id FROM public.agentmail_inboxes
      WHERE tenant_id = ${tenantId()}
      ORDER BY created_at ASC
      LIMIT 1
    `) as unknown as Array<{ account_id: string }>;
    if (rows[0]?.account_id) return rows[0].account_id;
  } catch {
    /* fall through to live lookup */
  }
  // Live AgentMail lookup as a fallback (adopts inboxes created outside KeyCommand).
  try {
    const { listInboxes } = await import('./agentmail');
    const live: AmInbox[] = await listInboxes();
    return live[0]?.inbox_id ?? null;
  } catch {
    return null;
  }
}

// ── Per-tenant send pass ─────────────────────────────────────────────────────

/** Render a follow-up email body. The owner already approved seq.body; we send it
 *  verbatim (never regenerated). Falls back to an empty string so a null body is a
 *  send-failure surfaced by AgentMail validation, not a crash. */
function renderText(row: DueRow): string {
  return (row.body ?? '').toString();
}

/**
 * Run the cadence pass for the CURRENT tenant context. `remaining` bounds how many
 * sends this tenant may take (so the global batch cap is shared across tenants).
 */
async function dispatchForTenant(remaining: number): Promise<CadenceSummary> {
  const skips: Record<string, number> = {};
  const bump = (reason: string) => {
    skips[reason] = (skips[reason] ?? 0) + 1;
  };

  // Belt-and-suspenders: re-confirm both switches inside the tenant context.
  if (!globalEnabled() || !(await tenantEnabled())) {
    return { sent: 0, skipped: 0, disabled: true, skips };
  }
  if (remaining <= 0) return { sent: 0, skipped: 0, skips };

  // Resolve the tenant's AgentMail key + sending inbox up front. If either is
  // missing, every due step skips with the same reason (no per-row external call).
  const hasKey = (await getAgentMailKey()) !== null;
  const inboxId = hasKey ? await resolveSendingInbox() : null;
  const hasInbox = !!inboxId;

  // CLAIM due steps atomically. Flip them to 'sent'/sent_at=now() in the same
  // statement that selects them so a concurrent run can't also claim them. We only
  // claim up to `remaining` rows. We send only the rows we actually claimed; any row
  // that turns out to be ineligible (paused/no-email/etc.) is reverted to 'approved'.
  const claimed = (await sql()`
    UPDATE public.sequences AS s
    SET status = 'sent', sent_at = now()
    FROM public.leads AS l
    WHERE s.id IN (
      SELECT s2.id FROM public.sequences s2
      JOIN public.leads l2 ON l2.id = s2.lead_id AND l2.tenant_id = ${tenantId()}
      WHERE s2.tenant_id = ${tenantId()}
        AND s2.status = 'approved'
        AND s2.sent_at IS NULL
        AND s2.scheduled_for IS NOT NULL
        AND s2.scheduled_for <= now()
        -- Never auto-send to a suppressed contact (opt-out / bounce /
        -- domain block). Enforced in the CLAIM so a suppressed row is never
        -- even flipped to 'sent' — CAN-SPAM + deliverability safety.
        AND NOT EXISTS (
          SELECT 1 FROM public.suppression sp
          WHERE sp.tenant_id = ${tenantId()}
            AND (
              lower(sp.email) = lower(l2.email)
              OR (sp.type = 'domain_block' AND lower(l2.email) LIKE '%@' || lower(sp.email))
            )
        )
      ORDER BY s2.scheduled_for ASC
      LIMIT ${remaining}
    )
    AND l.id = s.lead_id AND l.tenant_id = ${tenantId()}
    AND s.tenant_id = ${tenantId()}
    RETURNING
      s.id, s.lead_id, s.step, s.subject, s.body, s.sequence_name,
      l.email, l.status AS lead_status, l.pause_outreach, l.first_name, l.last_name
  `) as unknown as DueRow[];

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of claimed) {
    const decision = eligibility(
      { email: row.email, status: row.lead_status, pause_outreach: row.pause_outreach },
      { status: 'approved' }, // we only ever claimed approved rows
      hasInbox,
      globalEnabled(),
      true, // tenantEnabled already verified above
    );

    if (decision !== 'send') {
      // Not actually sendable — release the claim back to 'approved' so the owner's
      // approval is preserved and it can fire later (e.g. once outreach is unpaused).
      await releaseClaim(row.id);
      skipped++;
      bump(decision);
      console.log(`[cadence] tenant ${tenantId()} skip seq ${row.id}: ${decision}`);
      continue;
    }

    // Best-effort send — one failure must not abort the batch.
    try {
      await sendEmail(inboxId as string, {
        to: [row.email as string],
        subject: row.subject || 'Following up',
        text: renderText(row),
      });
      // Already marked status='sent', sent_at=now() by the claim. Just advance the lead.
      await advanceLead(row);
      sent++;
    } catch (err) {
      failed++;
      const msg = (err as Error).message?.slice(0, 200) ?? 'send failed';
      await markSendFailed(row.id);
      console.error(`[cadence] tenant ${tenantId()} send FAILED seq ${row.id}: ${msg}`);
    }
  }

  return { sent, skipped, failed, skips };
}

/** Revert a claimed-but-not-sendable row back to 'approved' (keeps owner approval). */
async function releaseClaim(seqId: string): Promise<void> {
  await sql()`
    UPDATE public.sequences
    SET status = 'approved', sent_at = NULL
    WHERE id = ${seqId} AND tenant_id = ${tenantId()}
  `.catch((e) => console.error(`[cadence] releaseClaim ${seqId} failed:`, (e as Error).message));
}

/** A send threw AFTER we claimed the row. Revert to 'approved' so it retries next
 *  tick (NEVER leave a failed step marked 'sent'). */
async function markSendFailed(seqId: string): Promise<void> {
  await sql()`
    UPDATE public.sequences
    SET status = 'approved', sent_at = NULL
    WHERE id = ${seqId} AND tenant_id = ${tenantId()}
  `.catch((e) => console.error(`[cadence] markSendFailed ${seqId} failed:`, (e as Error).message));
}

/** On a successful send: stamp the lead's last_touch_at, advance next_action_at to the
 *  next follow-up window, and move a still-'approved' lead to 'contacted'. Best-effort. */
async function advanceLead(row: DueRow): Promise<void> {
  const nextActionDays = DEFAULT_CADENCE_INTERVAL_DAYS;
  await sql()`
    UPDATE public.leads
    SET last_touch_at = now(),
        next_action_at = now() + (${nextActionDays} || ' days')::interval,
        status = CASE WHEN status = 'approved' THEN 'contacted' ELSE status END
    WHERE id = ${row.lead_id} AND tenant_id = ${tenantId()}
  `.catch((e) => console.error(`[cadence] advanceLead ${row.lead_id} failed:`, (e as Error).message));
  // Activity log so the touch shows up in the CRM timeline (best-effort).
  await sql()`
    INSERT INTO public.activity_log (tenant_id, ts, action, detail, result)
    VALUES (${tenantId()}, now(), 'crm', ${`lead:${row.lead_id} cadence step ${row.step ?? '?'} sent`}, NULL)
  `.catch(() => {});
}

// ── Public entrypoint ────────────────────────────────────────────────────────

/**
 * System-wide cadence dispatch. Called by the hourly /api/cron/cadence route.
 * No-op (returns {disabled:true}) unless the global env switch is on. Iterates the
 * tenants that opted in, sending each tenant's due approved steps inside its own
 * tenant context, sharing one global batch cap across all tenants.
 */
export async function dispatchDueCadence(): Promise<CadenceSummary> {
  // Global kill switch — engine ships inert.
  if (!globalEnabled()) {
    return { sent: 0, skipped: 0, disabled: true };
  }

  const tenants = await optedInTenants();
  if (tenants.length === 0) {
    return { sent: 0, skipped: 0, tenants: 0 };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const skips: Record<string, number> = {};

  for (const tid of tenants) {
    const remaining = CADENCE_BATCH_LIMIT - sent;
    if (remaining <= 0) break; // global cap reached — remaining tenants run next tick
    try {
      const r = await runWithTenant({ tenantId: tid, userId: null }, () => dispatchForTenant(remaining));
      sent += r.sent;
      skipped += r.skipped;
      failed += r.failed ?? 0;
      for (const [k, v] of Object.entries(r.skips ?? {})) skips[k] = (skips[k] ?? 0) + v;
    } catch (err) {
      console.error(`[cadence] tenant ${tid} sweep threw:`, (err as Error).message);
    }
  }

  return { sent, skipped, failed, tenants: tenants.length, skips };
}
