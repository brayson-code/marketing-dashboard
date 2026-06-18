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
