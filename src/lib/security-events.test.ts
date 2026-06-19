import assert from 'node:assert/strict';
import { test } from 'node:test';

// IMPORTANT: ensure the DB is genuinely unconfigured so sql() throws on connect — this
// is the exact failure path the "never throws into the caller" contract must survive.
// (No real DB in unit tests; the connection string is the trigger.) Mirrors the
// codebase convention of exercising the decision/safety surface without a live DB.
delete process.env.SUPABASE_DB_URL;

import { emitSecurityEvent, type SecurityEventInput } from './security-events';

// ── The load-bearing contract: emit is fire-and-forget safe ──────────────────
// Callers do `void emitSecurityEvent(...)` on the hot path (owner-gate, 429 sites).
// If it ever threw — sync OR async — it could break a request or surface an
// unhandled rejection. With SUPABASE_DB_URL unset, sql() throws on connect, so this
// test drives the exact catch path.

test('emitSecurityEvent never throws when the DB is unreachable (resolves void)', async () => {
  const input: SecurityEventInput = {
    type: 'authz_deny',
    severity: 'warning',
    resourceRef: 'tenant',
    detail: { reason: 'requires_owner', action: 'rotate_secret' },
  };
  // Must RESOLVE (not reject) even though the underlying INSERT cannot run.
  const result = await emitSecurityEvent(input);
  assert.equal(result, undefined);
});

test('emitSecurityEvent does not reject for a critical event (alert path is best-effort)', async () => {
  // Critical severity additionally tries to lazy-import ./security-alerts and call
  // maybeAlert(); that module may be absent and/or its notify channels unconfigured.
  // The whole thing must still resolve to void without rejecting.
  await assert.doesNotReject(
    emitSecurityEvent({
      type: 'cross_tenant_attempt',
      severity: 'critical',
      detail: { reason: 'membership_revoked' },
    }),
  );
});

test('emitSecurityEvent tolerates a null actor and absent detail', async () => {
  await assert.doesNotReject(
    emitSecurityEvent({ type: 'auth_fail', severity: 'info', actorUserId: null }),
  );
});

// Synchronous-call safety: the hot-path callers do `void emitSecurityEvent(...)`. Verify
// invoking it never throws SYNCHRONOUSLY (a sync throw would escape the `void` form).
test('emitSecurityEvent never throws synchronously when invoked', () => {
  assert.doesNotThrow(() => {
    void emitSecurityEvent({ type: 'rate_limited', severity: 'info', resourceRef: 'help' });
  });
});
