// uptime.ts — self-contained liveness self-check + HQ alert path.
//
// WHAT THIS IS: a best-effort, in-process health probe that the uptime cron route
// (/api/cron/uptime) invokes. It checks the two infra dependencies that actually
// take the app down — the database and (if configured) the Vercel Blob store —
// and, on a NEW failure, notifies the HQ owner over the existing notify channels.
//
// WHY THIS IS NOT THE PRIMARY MONITOR: Vercel Cron's finest practical cadence on
// this project is HOURLY (sub-hour schedules round up to the top of the hour — see
// the cron-board memory + ops/docs/uptime-monitoring.md). An hour of downtime
// before an alert is far too coarse. So this is the SECONDARY net: an EXTERNAL
// 1-min pinger hitting /api/health/live is the real fast-detection path. This
// cron exists so that even with no external monitor wired, a sustained outage
// still produces an owner alert within the hour, with edge-triggered de-dup so a
// long outage doesn't text every tick.
//
// ALERT DELIVERY: we notify the HQ owner via the same channels the rest of the
// app already uses — iMessage (LoopMessage, getOwnerPhone) + Slack webhook — both
// of which no-op gracefully when unconfigured. (Stream D's security-alerts.ts is
// the richer, deduped HQ-alert module; this file deliberately does NOT import it
// to avoid a cross-stream file dependency. When that module lands, this can be
// switched to route critical uptime failures through it.)

import { sql } from './db/client';
import { DEFAULT_TENANT_ID, runWithTenant } from './tenant';
import { sendIMessage, getOwnerPhone } from './loopmessage';
import { sendSlack, isSlackConfigured } from './alerts';

export type UptimeCheckState = 'ok' | 'down' | 'unconfigured';

export interface UptimeResult {
  ok: boolean;
  db: 'ok' | 'down';
  blob: UptimeCheckState;
  failures: string[];      // human-readable failing-component list (empty when healthy)
  alerted: boolean;        // whether this run fired an owner alert
  checkedAt: string;
}

/** DB liveness — trivial round-trip. */
async function checkDb(): Promise<'ok' | 'down'> {
  try {
    await sql()`SELECT 1`;
    return 'ok';
  } catch {
    return 'down';
  }
}

/** Blob liveness — 'unconfigured' without a token, else reachability via head().
 *  A BlobNotFoundError is the healthy "store responded" answer. */
async function checkBlob(): Promise<UptimeCheckState> {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return 'unconfigured';
  try {
    const { head, BlobNotFoundError } = await import('@vercel/blob');
    try {
      await head(`__healthcheck__/does-not-exist-${Date.now()}`, { token });
      return 'ok';
    } catch (err) {
      if (err instanceof BlobNotFoundError) return 'ok';
      return 'down';
    }
  } catch {
    return 'down';
  }
}

// Edge-triggered de-dup: remember the last failure signature so a sustained
// outage alerts ONCE (on transition into failure), not every tick. Recovery
// clears it so the next distinct failure alerts again. Module-scoped — fine for
// the single-invocation cron; on serverless each cold start simply re-arms it,
// which at worst sends one extra alert (acceptable for an outage).
let lastFailureSig: string | null = null;

/**
 * Run the liveness self-check and, on a newly-detected failure, alert the HQ
 * owner. Never throws — a monitor that crashes is worse than one that's quiet.
 * Runs the alert send inside the HQ tenant context so getOwnerPhone()/sendIMessage
 * resolve the platform owner's number.
 */
export async function runUptimeCheck(): Promise<UptimeResult> {
  const [db, blob] = await Promise.all([checkDb(), checkBlob()]);

  const failures: string[] = [];
  if (db === 'down') failures.push('database');
  if (blob === 'down') failures.push('blob storage');

  const ok = failures.length === 0;
  const sig = failures.join(',');
  let alerted = false;

  if (!ok && sig !== lastFailureSig) {
    // New (or changed) failure → alert once.
    alerted = await alertOwner(failures);
    lastFailureSig = sig;
  } else if (ok && lastFailureSig !== null) {
    // Recovered → notify + re-arm so the next outage alerts again.
    await alertOwner([], /* recovered */ true);
    lastFailureSig = null;
  }

  return { ok, db, blob, failures, alerted, checkedAt: new Date().toISOString() };
}

/** Fan the alert to the HQ owner over the existing channels. Best-effort. */
async function alertOwner(failures: string[], recovered = false): Promise<boolean> {
  const text = recovered
    ? '✅ Command Center recovered — all infra liveness checks pass again.'
    : `🚨 Command Center health check FAILED — unreachable: ${failures.join(', ')}. ` +
      `Check /api/health/live and the Vercel/Supabase dashboards.`;

  let delivered = false;
  // Run inside HQ context so getOwnerPhone()/sendIMessage target the platform owner.
  await runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, async () => {
    try {
      if (getOwnerPhone()) {
        const r = await sendIMessage(text, { recipient: getOwnerPhone()!, agent: 'uptime' });
        if (r.ok) delivered = true;
      }
    } catch {
      /* iMessage best-effort */
    }
    try {
      if (isSlackConfigured()) {
        const r = await sendSlack(text);
        if (r.ok) delivered = true;
      }
    } catch {
      /* Slack best-effort */
    }
  });
  return delivered;
}
