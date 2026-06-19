import assert from 'node:assert/strict';
import { test, beforeEach } from 'node:test';

// Ensure a clean, UNCONFIGURED env: no owner phone, no alert email. This is the default
// deployment shape the "no-op when unconfigured" contract must survive. (Mirrors the
// security-events test convention of driving the safety path with env absent.)
delete process.env.KEYPLAYERS_OWNER_PHONE;
delete process.env.KEYPLAYERS_ALERT_EMAIL;
delete process.env.KEYPLAYERS_OWNER_EMAIL;
// Tight, deterministic windows so the spike test doesn't depend on real time.
process.env.SECURITY_SPIKE_WINDOW_MS = '60000';
process.env.SECURITY_SPIKE_THRESHOLD = '3';

import {
  maybeAlert,
  noteForSpike,
  isSpiking,
  __resetSecurityAlerts,
} from './security-alerts';
import type { SecurityEventInput } from './security-events';

beforeEach(() => {
  __resetSecurityAlerts();
});

const critical: SecurityEventInput = {
  type: 'cross_tenant_attempt',
  severity: 'critical',
  detail: { reason: 'membership_revoked' },
};

// ── No-op when unconfigured ──────────────────────────────────────────────────
// With no owner phone AND no alert email, maybeAlert must resolve to void without
// touching any channel (and without throwing).
test('maybeAlert no-ops (resolves void, never throws) when unconfigured', async () => {
  const result = await maybeAlert(critical);
  assert.equal(result, undefined);
});

test('maybeAlert never rejects even for a malformed/non-serializable detail', async () => {
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic; // JSON.stringify would throw — renderAlert must tolerate it
  await assert.doesNotReject(
    maybeAlert({ type: 'auth_fail', severity: 'critical', detail: cyclic }),
  );
});

// ── Dedup / cooldown ─────────────────────────────────────────────────────────
// Even unconfigured, the FIRST call for a key records cooldown state; subsequent calls
// within the window are suppressed. We can't observe a send (no channels), but we CAN
// assert it never throws across a burst — the storm-prevention path stays exercised.
test('maybeAlert tolerates a burst of the same event (dedup path, no throw)', async () => {
  for (let i = 0; i < 25; i++) {
    await assert.doesNotReject(maybeAlert(critical));
  }
});

// ── Spike detection ──────────────────────────────────────────────────────────
test('noteForSpike counts within the window and isSpiking trips at the threshold', () => {
  const ev: SecurityEventInput = {
    type: 'auth_fail',
    severity: 'info',
    actorUserId: 'attacker-1',
  };
  assert.equal(isSpiking(ev), false);
  assert.equal(noteForSpike(ev), 1);
  assert.equal(noteForSpike(ev), 2);
  assert.equal(isSpiking(ev), false); // threshold is 3, only 2 so far
  assert.equal(noteForSpike(ev), 3);
  assert.equal(isSpiking(ev), true); // crossed
});

test('spike state is isolated per actor and per type', () => {
  const a: SecurityEventInput = { type: 'auth_fail', severity: 'info', actorUserId: 'a' };
  const b: SecurityEventInput = { type: 'auth_fail', severity: 'info', actorUserId: 'b' };
  const aOther: SecurityEventInput = { type: 'rate_limited', severity: 'info', actorUserId: 'a' };
  noteForSpike(a);
  noteForSpike(a);
  noteForSpike(a);
  assert.equal(isSpiking(a), true);
  // A different actor with the same type must NOT inherit a's spike.
  assert.equal(isSpiking(b), false);
  // The same actor with a different type is a separate window too.
  assert.equal(isSpiking(aOther), false);
});

test('__resetSecurityAlerts clears spike state', () => {
  const ev: SecurityEventInput = { type: 'auth_fail', severity: 'info', actorUserId: 'x' };
  noteForSpike(ev);
  noteForSpike(ev);
  noteForSpike(ev);
  assert.equal(isSpiking(ev), true);
  __resetSecurityAlerts();
  assert.equal(isSpiking(ev), false);
});
