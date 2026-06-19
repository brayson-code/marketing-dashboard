// security-alerts.ts — HQ-owner notification for CRITICAL security events (Stream D).
//
// emitSecurityEvent() (FOUNDATION, security-events.ts) lazy-imports this module and
// calls maybeAlert() on every severity:'critical' event. This module's job is to turn
// a high-signal event into an out-of-band ping to the PLATFORM (HQ) owner — Brayson —
// over the channels the codebase already has: LoopMessage iMessage (sendIMessage) and
// transactional email (sendTransactionalEmail → AgentMail/Resend).
//
// HARD RULES (mirrors emitSecurityEvent's contract):
//  - NEVER throws into the caller. Every channel is wrapped; a delivery failure is a
//    swallowed warn, not a request-breaking error. The request path already returned by
//    the time this runs (emit is void/fire-and-forget).
//  - DEGRADES TO A NO-OP when unconfigured: no owner phone (KEYPLAYERS_OWNER_PHONE) AND
//    no alert email (KEYPLAYERS_ALERT_EMAIL / KEYPLAYERS_OWNER_EMAIL) → it returns
//    silently. LoopMessage / AgentMail not connected → those channels are individually
//    skipped. The build stays green and tests pass with all of these env vars absent.
//  - DEDUPES so one incident isn't a notification storm. An in-memory cooldown keyed on
//    `${type}:${resourceRef}` suppresses repeat sends inside the window. In-memory is
//    per-instance (same caveat as rate-limit.ts) — acceptable: at worst a few duplicate
//    pings across serverless instances, never a missed first alert.
//
// WHAT COUNTS AS CRITICAL is decided upstream by the emitter (it passes severity).
// Today the critical emitters are: cross_tenant_attempt (a removed/stale-claim member
// hitting a tenant they don't belong to), and any caller that escalates a spike of
// authz_deny / auth_fail / off-hours secret access to 'critical'. This module also
// runs a lightweight in-process SPIKE detector (per actor+type) so a burst of the same
// event from one actor is itself escalated into an alert even if each individual event
// was only 'warning' — see noteForSpike().

import type { SecurityEventInput } from './security-events';

// ── Config (all optional; absence = that channel is off) ─────────────────────

/** The HQ owner's cell (env KEYPLAYERS_OWNER_PHONE). Same value loopmessage.ts reads. */
function ownerPhone(): string | null {
  return process.env.KEYPLAYERS_OWNER_PHONE?.trim() || null;
}

/** Where security alert email goes. Dedicated var first, then a generic owner email. */
function alertEmail(): string | null {
  return (
    process.env.KEYPLAYERS_ALERT_EMAIL?.trim() ||
    process.env.KEYPLAYERS_OWNER_EMAIL?.trim() ||
    null
  );
}

// ── Dedup / cooldown ─────────────────────────────────────────────────────────

// Read at call-time (see spike helpers) — default 15 min between repeat alerts per key.
function alertCooldownMs(): number {
  return Number(process.env.SECURITY_ALERT_COOLDOWN_MS) || 15 * 60_000;
}

// Last-sent timestamp per dedup key. In-memory, per-instance, bounded by the small
// number of (type:resourceRef) combinations — no growth concern in practice.
const lastSent = new Map<string, number>();

function dedupKey(event: SecurityEventInput): string {
  return `${event.type}:${event.resourceRef ?? '*'}`;
}

/** True (and records the send) when this event is OUTSIDE its cooldown — i.e. we should
 *  alert now. False when a recent alert for the same key already went out. */
function shouldSend(event: SecurityEventInput, now: number): boolean {
  const key = dedupKey(event);
  const prev = lastSent.get(key);
  if (prev !== undefined && now - prev < alertCooldownMs()) return false;
  lastSent.set(key, now);
  return true;
}

// ── Spike detection (per actor + type) ───────────────────────────────────────
//
// A single failed login is noise; 20 in a minute from one actor is an incident. We
// keep a rolling per-(actor:type) hit list and report when it crosses a threshold so a
// 'warning'-level emitter can be escalated to an alert. Purely in-memory and best-effort.

// Read at call-time (not module-load) so deployment env / tests are honored regardless of
// import-hoisting order. Defaults: a 60s window, 10 hits → spiking.
function spikeWindowMs(): number {
  return Number(process.env.SECURITY_SPIKE_WINDOW_MS) || 60_000;
}
function spikeThreshold(): number {
  return Number(process.env.SECURITY_SPIKE_THRESHOLD) || 10;
}

const spikeHits = new Map<string, number[]>();

function spikeKey(event: SecurityEventInput): string {
  return `${event.actorUserId ?? 'anon'}:${event.type}`;
}

/**
 * Record one occurrence of `event` and return the count within the rolling window.
 * Exposed so emit points that DON'T pass severity:'critical' themselves (e.g. the
 * per-429 / auth-fail sites) can still trip an alert on a burst: a caller can check
 * `noteForSpike(event) >= SPIKE_THRESHOLD` and, if so, emit a 'critical' variant.
 */
export function noteForSpike(event: SecurityEventInput): number {
  const key = spikeKey(event);
  const now = Date.now();
  const recent = (spikeHits.get(key) ?? []).filter((t) => now - t < spikeWindowMs());
  recent.push(now);
  spikeHits.set(key, recent);
  return recent.length;
}

/** True when this event type+actor has crossed the spike threshold in the window.
 *  Read-only (does NOT record a hit) — pair with noteForSpike() at the call site. */
export function isSpiking(event: SecurityEventInput): boolean {
  const key = spikeKey(event);
  const now = Date.now();
  const recent = (spikeHits.get(key) ?? []).filter((t) => now - t < spikeWindowMs());
  return recent.length >= spikeThreshold();
}

// ── Message rendering ─────────────────────────────────────────────────────────

function severityTag(s: SecurityEventInput['severity']): string {
  return s === 'critical' ? '🔴 CRITICAL' : s === 'warning' ? '🟠 WARNING' : 'ℹ️ INFO';
}

function renderAlert(event: SecurityEventInput): { subject: string; text: string } {
  const tag = severityTag(event.severity);
  const tenant = event.tenantId ?? '(current tenant)';
  const actor = event.actorUserId === null ? 'anon/system' : event.actorUserId ?? '(unknown)';
  const resource = event.resourceRef ?? '(none)';
  let detailStr = '';
  try {
    detailStr = event.detail ? JSON.stringify(event.detail) : '';
  } catch {
    detailStr = '(detail not serializable)';
  }
  // Spike count, if this key is hot, gives the owner the "how bad" at a glance.
  const count = isSpiking(event) ? ' (spiking)' : '';

  const subject = `[Command Center] Security: ${event.type} ${tag}`;
  const text =
    `${tag} security event${count}\n\n` +
    `type:     ${event.type}\n` +
    `tenant:   ${tenant}\n` +
    `actor:    ${actor}\n` +
    `resource: ${resource}\n` +
    (detailStr ? `detail:   ${detailStr}\n` : '') +
    `\nThis is an automated alert from the Command Center security console.`;
  return { subject, text };
}

// ── Delivery ───────────────────────────────────────────────────────────────────

/**
 * Notify the HQ owner about a critical security event. Best-effort + deduped + no-op
 * when unconfigured. Called by emitSecurityEvent() (lazy import) on severity:'critical';
 * never called directly by request handlers. Always resolves to void; never throws.
 */
export async function maybeAlert(event: SecurityEventInput & { created_at?: string }): Promise<void> {
  try {
    const phone = ownerPhone();
    const email = alertEmail();
    // Fully unconfigured → nothing to do. Cheap exit before we touch the dedup map so an
    // unconfigured deployment never even allocates cooldown state.
    if (!phone && !email) return;

    const now = Date.now();
    if (!shouldSend(event, now)) return; // within cooldown — already pinged for this key

    const { subject, text } = renderAlert(event);

    // Fire both channels independently so one being unconfigured/failing never blocks the
    // other. Each is wrapped: a thrown send is downgraded to a warn. We DON'T await-race
    // them in a way that lets a rejection escape — allSettled guarantees resolve.
    const tasks: Array<Promise<unknown>> = [];

    if (phone) {
      tasks.push(
        (async () => {
          try {
            // Dynamic import keeps security-alerts a light leaf and avoids any cycle.
            // PLATFORM send: always uses the HQ env LoopMessage account → the operator's
            // phone, regardless of which tenant's context the event fired in (a client-
            // workspace event would otherwise try that client's LoopMessage and miss us).
            const { sendPlatformAlertIMessage } = await import('./loopmessage');
            const res = await sendPlatformAlertIMessage(text);
            if (!res.ok) console.warn(`[security-alert] iMessage not sent: ${res.error}`);
          } catch (e) {
            console.warn('[security-alert] iMessage channel failed:', (e as Error).message);
          }
        })(),
      );
    }

    if (email) {
      tasks.push(
        (async () => {
          try {
            const { sendTransactionalEmail } = await import('./transactional-email');
            // Plain-text-first; reuse the renderer's body as both. HTML is the escaped
            // body so the email client renders the monospace-ish block readably.
            const html = `<pre style="font-family:ui-monospace,Menlo,monospace;font-size:13px;line-height:1.5;color:#f4f6f8;background:#0e1116;padding:16px;border-radius:8px;white-space:pre-wrap;">${escapeHtml(
              text,
            )}</pre>`;
            const res = await sendTransactionalEmail({ to: email, subject, text, html });
            if (!res.sent) console.warn(`[security-alert] email not sent: ${res.reason}`);
          } catch (e) {
            console.warn('[security-alert] email channel failed:', (e as Error).message);
          }
        })(),
      );
    }

    await Promise.allSettled(tasks);
  } catch (e) {
    // Absolute backstop: alerting must NEVER throw into emitSecurityEvent (which itself
    // never throws into the request path). Swallow.
    console.warn('[security-alert] unexpected failure:', (e as Error).message);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Test hook: clear dedup + spike state between cases. */
export function __resetSecurityAlerts(): void {
  lastSent.clear();
  spikeHits.clear();
}
