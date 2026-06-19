// Per-tenant in-memory sliding-window rate limiter.
//
// In-memory (Map) — resets on instance restart, and is per-instance (not shared
// across serverless workers). This is intentionally the SAME approach already used
// inline by the sub-agent limiter (src/lib/subagent.ts) and the movie-clip search
// route: it's a cheap, good-enough abuse brake for V1, not a distributed quota.
// Production-hardening (Redis/Upstash) is a known follow-up. This module just
// consolidates the copy-pasted pattern into one tested place so the unguarded
// endpoints in the audit can all share it.
//
// Key on `${tenantId()}:${bucket}` so one workspace hammering an endpoint cannot
// throttle another — the per-tenant property the audit asks for.

import { emitSecurityEvent, type SecurityEventInput } from './security-events';
import { hasTenantContext } from './tenant';

export interface RateLimitResult {
  /** True when this call is WITHIN budget (allowed). */
  ok: boolean;
  /** Seconds until the window frees up (>=1). Only meaningful when ok === false. */
  retryAfterSec: number;
  /** Requests still available in the current window (0 when blocked). */
  remaining: number;
}

interface Bucket {
  windowMs: number;
  max: number;
}

// One Map per logical limiter, lazily created. Keyed by the caller's composite key
// (typically `${tenantId()}:${name}`). Values are the timestamps (ms) of recent hits.
const stores = new Map<string, Map<string, number[]>>();

function storeFor(name: string): Map<string, number[]> {
  let s = stores.get(name);
  if (!s) { s = new Map(); stores.set(name, s); }
  return s;
}

/**
 * Record a hit against a sliding window and report whether it's allowed.
 *
 * @param name    logical limiter name (also the Map namespace), e.g. 'help'
 * @param key     the per-subject key, e.g. `${tenantId()}` — combined with `name`
 * @param bucket  { windowMs, max } — at most `max` hits per rolling `windowMs`
 *
 * Mirrors the existing inline pattern: filters out timestamps older than the
 * window, blocks (WITHOUT recording the hit) when the window is full, otherwise
 * records the hit and allows. Blocked requests are NOT counted, so a client that
 * keeps hammering during a block doesn't extend its own penalty unboundedly.
 */
export function rateLimit(name: string, key: string, bucket: Bucket): RateLimitResult {
  const { windowMs, max } = bucket;
  const store = storeFor(name);
  const now = Date.now();
  const recent = (store.get(key) ?? []).filter((t) => now - t < windowMs);

  if (recent.length >= max) {
    // Keep the trimmed list so memory doesn't grow, but do NOT record this hit.
    store.set(key, recent);
    const oldest = Math.min(...recent);
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    // Emit a security event on the limit hit (fire-and-forget). One point here covers
    // every shared-limiter call site (help/assets/agent-tasks/boardroom/webhooks) without
    // editing those routes. Best-effort: emitRateLimited never throws into this sync path.
    emitRateLimited(name, key, retryAfterSec);
    return { ok: false, retryAfterSec, remaining: 0 };
  }

  recent.push(now);
  store.set(key, recent);
  return { ok: true, retryAfterSec: 0, remaining: Math.max(0, max - recent.length) };
}

/** Reset all windows for a limiter (used by tests). */
export function __resetRateLimit(name?: string): void {
  if (name) stores.delete(name);
  else stores.clear();
}

// A bare uuid (the webhook path id) — used to recover the tenant scope when a webhook
// limiter trips BEFORE its handler enters tenant context (it keys on the path tenantId).
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best-effort security event for a 429/limit hit. Synchronous-safe: it never awaits and
 * never throws — emitSecurityEvent swallows all errors and is invoked via `void`, so the
 * pure sync rateLimit() contract (and its unit tests) are unaffected.
 *
 * Tenant scoping:
 *  - Inside a request tenant context (help/assets/agent-tasks/boardroom) → emit uses the
 *    active tenantId() automatically; the limiter `key` (a tenant uuid, or `ip:...` for
 *    anonymous help) is recorded only as a redacted shape, never raw PII.
 *  - Webhook limiters trip BEFORE entering tenant context but key on the path tenant uuid
 *    → pass that uuid as the tenantId override so the event lands in the right workspace,
 *    and mark it `warning` (webhook abuse can spawn LLM runs).
 *
 * Spike escalation: a burst of limit hits for the same (actor/type) is escalated to a
 * `critical` event so the FOUNDATION emit path fires the HQ-owner alert (deduped).
 */
function emitRateLimited(name: string, key: string, retryAfterSec: number): void {
  // Webhook sites are the ones that run outside a tenant context with a uuid key.
  const keyedByUuid = !hasTenantContext() && UUID_RE.test(key);
  const isWebhook = name.startsWith('webhook-');

  // Redact the key: never record a raw IP. Bucket it into a shape instead.
  const keyShape = UUID_RE.test(key) ? 'tenant' : key.startsWith('ip:') ? 'ip' : 'other';

  const base: SecurityEventInput = {
    type: 'rate_limited',
    severity: isWebhook ? 'warning' : 'info',
    resourceRef: name,
    detail: { retryAfterSec, keyShape },
    ...(keyedByUuid ? { tenantId: key } : {}),
  };

  // Escalate a sustained burst to critical so it pages the HQ owner (deduped upstream).
  // We reach the spike helpers via a DYNAMIC import (not a static one) so rate-limit.ts
  // stays a leaf with no static edge to security-alerts → loopmessage/transactional-email
  // (no import cycle). The whole thing is void + best-effort; it never blocks the limiter.
  void escalateAndEmit(base);
}

async function escalateAndEmit(base: SecurityEventInput): Promise<void> {
  try {
    const { noteForSpike, isSpiking } = await import('./security-alerts');
    noteForSpike(base);
    const event: SecurityEventInput = isSpiking(base) ? { ...base, severity: 'critical' } : base;
    await emitSecurityEvent(event);
  } catch {
    // Best-effort: a spike-module or emit failure must never affect the limiter.
    try {
      await emitSecurityEvent(base);
    } catch {
      /* swallow — emit is itself best-effort */
    }
  }
}
