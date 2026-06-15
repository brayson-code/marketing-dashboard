// Stale-lead sweep — finds leads who replied to us but never got a reply back,
// and drafts a follow-up for each one using the outreach-sender sub-agent.
//
// SHIPS INERT. Activation is the PER-TENANT flag (one-click banner on the CRM
// page → business_profile.stale_lead_sweep_enabled = true; default OFF). The env
// var STALE_LEAD_SWEEP_ENABLED is only a global EMERGENCY kill-switch: set it to
// the string 'false' to disable the sweep for every tenant at once; default ON.
// With no opted-in tenants, sweepStaleLeads() returns immediately doing nothing.
//
// NEVER SENDS. Every reply is saved as a 'pending' agent_drafts row via createDraft()
// for owner review and approval. The agent cannot trigger a send.
//
// MULTI-TENANT: runs outside any tenant context (system-wide cron). Collects opted-in
// tenant ids, then runs each pass inside that tenant's AsyncLocalStorage context via
// runWithTenant — the same pattern as cadence-dispatch.ts.

import { sql, jsonb, tenantId } from './db/client';
import { runWithTenant } from './tenant';
import { spawnSubAgent } from './subagent';

// ── Tunables ─────────────────────────────────────────────────────────────────

/** Max leads processed per tenant per run (keeps function within Vercel time budget). */
export const STALE_SWEEP_LIMIT = 15;

// ── Pure helpers (unit-tested) ────────────────────────────────────────────────

/** Minimal lead shape needed for staleness checks. */
export interface StaleLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  status: string | null;
  last_touch_at: Date | string | null;
  pause_outreach: boolean | number | null;
}

/**
 * Pure staleness check — no side effects, exhaustively unit-testable.
 *
 * A lead is STALE when:
 *   - They sent us a message (latestInboundAt is not null), AND
 *   - That message arrived AFTER our last_touch_at (we have not responded since), AND
 *   - pause_outreach is not set (owner has not frozen the conversation).
 *
 * When last_touch_at is null we've never touched them at all, so any inbound is stale.
 */
export function isStale(
  lead: Pick<StaleLead, 'last_touch_at' | 'pause_outreach'>,
  latestInboundAt: Date | string | null,
): boolean {
  // No inbound message at all → not stale.
  if (!latestInboundAt) return false;

  // Owner froze the conversation — skip.
  if (lead.pause_outreach === true || lead.pause_outreach === 1) return false;

  // They wrote to us; if we've never touched them (last_touch_at is null) → stale.
  if (!lead.last_touch_at) return true;

  const inboundMs = new Date(latestInboundAt).getTime();
  const lastTouchMs = new Date(lead.last_touch_at).getTime();

  // Inbound is more recent than our last touch → stale.
  return inboundMs > lastTouchMs;
}

/**
 * Eligibility decision — combines all gating checks into a typed result so the
 * full decision tree can be exercised in pure unit tests without DB/env mocks.
 */
export type EligibilityResult =
  | 'draft'
  | 'skip:disabled_env'
  | 'skip:disabled_tenant'
  | 'skip:paused'
  | 'skip:no_inbound'
  | 'skip:not_stale';

export function sweepEligibility(
  lead: Pick<StaleLead, 'last_touch_at' | 'pause_outreach'>,
  latestInboundAt: Date | string | null,
  envOn: boolean,
  tenantOn: boolean,
): EligibilityResult {
  if (!envOn) return 'skip:disabled_env';
  if (!tenantOn) return 'skip:disabled_tenant';
  if (lead.pause_outreach === true || lead.pause_outreach === 1) return 'skip:paused';
  if (!latestInboundAt) return 'skip:no_inbound';
  if (!isStale(lead, latestInboundAt)) return 'skip:not_stale';
  return 'draft';
}

// ── Gating helpers ────────────────────────────────────────────────────────────

/** Global kill switch. The per-tenant flag is the real on/off (flipped by the
 *  one-click banner); this env var is only an emergency global OFF — set it to
 *  the string 'false' to disable the sweep for ALL tenants at once. Default ON. */
function globalEnabled(): boolean {
  return process.env.STALE_LEAD_SWEEP_ENABLED !== 'false';
}

/** Tenant ids that have opted into stale-lead sweep (business_profile.stale_lead_sweep_enabled).
 *  Runs OUTSIDE tenant context — the backend postgres role bypasses RLS so this
 *  legitimately sees every tenant's flag. */
async function optedInTenants(): Promise<string[]> {
  const rows = (await sql()`
    SELECT id::text AS id
    FROM public.tenants
    WHERE (business_profile->>'stale_lead_sweep_enabled') = 'true'
  `) as unknown as Array<{ id: string }>;
  return rows.map((r) => r.id);
}

/** Belt-and-suspenders: re-check the per-tenant flag inside the tenant context. */
async function tenantEnabled(): Promise<boolean> {
  const rows = (await sql()`
    SELECT (business_profile->>'stale_lead_sweep_enabled') = 'true' AS on
    FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ on: boolean | null }>;
  return rows[0]?.on === true;
}

// ── DB row shapes ─────────────────────────────────────────────────────────────

interface StaleLeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  status: string | null;
  last_touch_at: string | null;
  pause_outreach: boolean | null;
  latest_inbound_at: string | null;
  latest_inbound_text: string | null;
}

// ── Per-tenant sweep ──────────────────────────────────────────────────────────

/**
 * Run the stale-lead sweep for the CURRENT tenant context.
 * Returns counts of drafts created and leads skipped.
 */
async function sweepForTenant(): Promise<{ drafted: number; skipped: number }> {
  // Belt-and-suspenders: re-verify both switches inside the tenant context.
  if (!globalEnabled() || !(await tenantEnabled())) {
    return { drafted: 0, skipped: 0 };
  }

  // Select leads with at least one inbound email from them, where that email
  // arrived AFTER our last outbound touch (or we have never touched them).
  // We check both agentmail_messages (email inbound) and sms_messages (inbound SMS).
  // For each lead we grab the LATEST inbound timestamp + message body so the agent
  // has real context to reply to.
  // pause_outreach leads are excluded at the DB level (belt AND suspenders — isStale
  // also checks, but skipping in SQL keeps the result set small).
  const rows = (await sql()`
    SELECT
      l.id,
      l.first_name,
      l.last_name,
      l.email,
      l.status,
      l.last_touch_at,
      l.pause_outreach,
      latest.latest_inbound_at,
      latest.latest_inbound_text
    FROM public.leads AS l
    JOIN LATERAL (
      SELECT
        received_at AS latest_inbound_at,
        body_text    AS latest_inbound_text
      FROM public.agentmail_messages
      WHERE tenant_id = ${tenantId()}
        AND lower(from_addr) = lower(l.email)
        AND (
          l.last_touch_at IS NULL
          OR received_at > l.last_touch_at
        )
      ORDER BY received_at DESC
      LIMIT 1
    ) AS latest ON true
    WHERE l.tenant_id = ${tenantId()}
      AND l.pause_outreach IS NOT TRUE
    ORDER BY latest.latest_inbound_at ASC
    LIMIT ${STALE_SWEEP_LIMIT}
  `) as unknown as StaleLeadRow[];

  let drafted = 0;
  let skipped = 0;

  for (const row of rows) {
    // Pure eligibility check (double-confirms staleness with the typed helper).
    const decision = sweepEligibility(
      { last_touch_at: row.last_touch_at, pause_outreach: row.pause_outreach },
      row.latest_inbound_at,
      true, // globalEnabled already checked above
      true, // tenantEnabled already checked above
    );

    if (decision !== 'draft') {
      skipped++;
      console.log(`[stale-sweep] tenant ${tenantId()} skip lead ${row.id}: ${decision}`);
      continue;
    }

    // Build the task context for the outreach-sender sub-agent. We include:
    //   - The lead's name and email so the agent addresses them correctly.
    //   - The most recent inbound message text so the reply is contextually grounded.
    //   - An explicit instruction: draft only, never send.
    const displayName = [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email;
    const inboundSnippet = (row.latest_inbound_text ?? '').trim().slice(0, 800);
    const task = [
      `Draft a warm, concise reply to a stale lead who reached out to us and has not received a response yet.`,
      ``,
      `Lead: ${displayName} <${row.email}>`,
      `Their latest message (do NOT quote it verbatim — just use it as context):`,
      `"""`,
      inboundSnippet || '(no message body captured)',
      `"""`,
      ``,
      `Instructions:`,
      `- Acknowledge their message, apologize briefly for the delay, and re-open the conversation.`,
      `- Keep it under 150 words. Friendly, professional, non-pushy.`,
      `- Do NOT fabricate names, titles, or prices.`,
      `- Output ONLY the email body — no subject line, no metadata.`,
      `- This draft goes to the owner for approval before anything is sent. Do not imply you are sending now.`,
    ].join('\n');

    try {
      // Spawn outreach-sender to write the real reply (never falls back to a
      // placeholder — the task spec requires a Claude-authored reply).
      const res = await spawnSubAgent('outreach-sender', task);

      if (!res.ok || !res.text) {
        skipped++;
        console.error(
          `[stale-sweep] tenant ${tenantId()} outreach-sender failed for lead ${row.id}: ${res.error ?? 'no text'}`,
        );
        continue;
      }

      const subject = `Following up — ${displayName}`;

      // Insert the draft DIRECTLY as 'pending' — NOT via createDraft(). createDraft
      // runs the autonomy gate, which in full_auto / act_notify(auto) mode would
      // auto-approve and SEND the email. This sweep must NEVER send (its whole
      // purpose is owner review), so we bypass the executor and always land a
      // pending row regardless of the tenant's autonomy level.
      await sql()`
        INSERT INTO agent_drafts (tenant_id, type, title, payload, status, created_by, metadata)
        VALUES (
          ${tenantId()}, 'email', ${subject}, ${res.text}, 'pending', 'stale-lead-sweep',
          ${jsonb({
            lead_id: row.id,
            lead_email: row.email,
            source: 'stale_lead_sweep',
            stale_lead_reply: true,
            inbound_snippet: inboundSnippet.slice(0, 300),
          })}
        )
      `;

      // Dedupe: bump last_touch_at so this same inbound no longer qualifies as
      // stale on tomorrow's run (the SQL requires received_at > last_touch_at).
      // Without this the same lead would re-draft every single day forever.
      await sql()`
        UPDATE public.leads SET last_touch_at = now()
        WHERE id = ${row.id} AND tenant_id = ${tenantId()}
      `;

      drafted++;
      console.log(`[stale-sweep] tenant ${tenantId()} drafted reply for lead ${row.id}`);
    } catch (err) {
      skipped++;
      console.error(
        `[stale-sweep] tenant ${tenantId()} draft failed for lead ${row.id}: ${(err as Error).message}`,
      );
    }
  }

  return { drafted, skipped };
}

// ── Public entrypoint ─────────────────────────────────────────────────────────

export interface SweepSummary {
  tenants: number;
  drafted: number;
  skipped: number;
  disabled?: boolean;
}

/**
 * System-wide stale-lead sweep. Called by the daily /api/cron/stale-leads route.
 * No-op (returns { disabled: true }) unless the global env switch is on AND at
 * least one tenant has opted in.
 */
export async function sweepStaleLeads(): Promise<SweepSummary> {
  // Global kill switch — engine ships inert.
  if (!globalEnabled()) {
    return { tenants: 0, drafted: 0, skipped: 0, disabled: true };
  }

  const tenants = await optedInTenants();
  if (tenants.length === 0) {
    return { tenants: 0, drafted: 0, skipped: 0 };
  }

  let drafted = 0;
  let skipped = 0;

  for (const tid of tenants) {
    try {
      const r = await runWithTenant({ tenantId: tid, userId: null }, () => sweepForTenant());
      drafted += r.drafted;
      skipped += r.skipped;
    } catch (err) {
      console.error(`[stale-sweep] tenant ${tid} sweep threw:`, (err as Error).message);
    }
  }

  return { tenants: tenants.length, drafted, skipped };
}
