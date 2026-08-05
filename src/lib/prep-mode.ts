// Prep mode — PURE. Read-only access for an assistant before day one.
//
// WHY IT EXISTS: the assistant is chosen days before they start. That gap is free value
// — they can read the business, the boundaries and the tools Client Success captured,
// and arrive already knowing things. What they must not do is ACT on the client's behalf
// before the client has even signed in.
//
// WHY IT IS ENFORCED ON THE JWT, NOT IN THE DATABASE: the enforcement point is the
// middleware, which runs on the Edge and has no database. Carrying `prep_until` in
// app_metadata means the check is a string comparison on a claim the server already
// validated — universal, no query, and impossible to bypass from the client.
//
// It also means it does NOT depend on AUTHZ_ENFORCE, which defaults to 'off' and makes
// the ordinary role helpers no-ops. Prep mode has to hold whatever that flag is set to.
//
// The rule is deliberately crude: reads pass, writes do not. A permission matrix would
// be more precise and would have far more ways to be wrong about a real client's data.

/** Methods that only read. Everything else is a write as far as prep mode cares. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function isReadOnlyMethod(method: string): boolean {
  return READ_METHODS.has(String(method ?? '').toUpperCase());
}

/**
 * Paths a person in prep must still be able to POST to, or they cannot finish signing
 * in or sign out again. Blocking these would lock the assistant out of their own
 * account, which is the opposite of the intent.
 */
export function isPrepExemptPath(pathname: string): boolean {
  const p = String(pathname ?? '');
  return p.startsWith('/api/auth/')      // session, sign out
    || p.startsWith('/auth/')            // confirm, set-password
    || p === '/api/errors'               // client error reporting
    || p === '/monitoring-tunnel';       // Sentry
}

/**
 * Is this claim value an ACTIVE prep window?
 *
 * Anything unparseable is treated as NOT in prep. Failing open is right here: the
 * downside of a wrong `false` is an assistant acting a day early, while the downside of
 * a wrong `true` is a working assistant silently unable to do their job with no error
 * anyone would understand.
 */
export function isInPrep(prepUntil: unknown, now: number): boolean {
  if (typeof prepUntil !== 'string' || !prepUntil) return false;
  const until = Date.parse(prepUntil);
  if (!Number.isFinite(until)) return false;
  return until > now;
}

/** The whole decision, in one call. True means this request must be refused. */
export function shouldBlockForPrep(input: {
  prepUntil: unknown;
  method: string;
  pathname: string;
  now: number;
}): boolean {
  if (!isInPrep(input.prepUntil, input.now)) return false;
  if (isReadOnlyMethod(input.method)) return false;
  if (isPrepExemptPath(input.pathname)) return false;
  return true;
}

/** What to tell them. Written for the assistant reading it, not for a log. */
export const PREP_MESSAGE =
  'You have read-only access until day one, so you can get to know the business before you start.';
