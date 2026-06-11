// Tiny in-memory TTL cache for tenant-scoped response caching on the hottest
// polled endpoints. This is per-server-process memory (best-effort on Vercel —
// it warms a single lambda instance), not a shared cache; the goal is to shave
// repeat DB work off rapid polling bursts within a TTL window.
//
// SECURITY: keys MUST be tenant-scoped by the caller. The backend bypasses RLS,
// so a global (non-tenant) key would leak one tenant's data to another. Callers
// build keys like `counts:${tenantId()}:...` — see the route handlers.

const store = new Map<string, { v: unknown; exp: number }>();

// In-flight de-dupe: a burst of identical requests shares ONE fn() execution.
const inflight = new Map<string, Promise<unknown>>();

/**
 * Return the cached value for `key` if its expiry is still in the future, else
 * run `fn()` (de-duping concurrent identical calls), store the result with an
 * expiry of now + `ttlMs`, and return it.
 */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.exp > now) {
    return hit.v as T;
  }

  // Share an already-running computation for this key.
  const pending = inflight.get(key);
  if (pending) {
    return pending as Promise<T>;
  }

  const p = (async () => {
    const v = await fn();
    store.set(key, { v, exp: Date.now() + ttlMs });
    return v;
  })();

  inflight.set(key, p);
  try {
    return (await p) as T;
  } finally {
    inflight.delete(key);
  }
}

/** Delete every cached key starting with `prefix` (e.g. to bust a tenant's entries). */
export function bust(prefix: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(prefix)) store.delete(key);
  }
}
