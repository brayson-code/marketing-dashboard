import assert from 'node:assert/strict';
import { test } from 'node:test';

import { rateLimit, __resetRateLimit } from './rate-limit';

test('rateLimit allows up to max then blocks within the window', () => {
  __resetRateLimit('t');
  const bucket = { windowMs: 60_000, max: 3 };
  assert.equal(rateLimit('t', 'a', bucket).ok, true);
  assert.equal(rateLimit('t', 'a', bucket).ok, true);
  const third = rateLimit('t', 'a', bucket);
  assert.equal(third.ok, true);
  assert.equal(third.remaining, 0);
  const blocked = rateLimit('t', 'a', bucket);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec >= 1);
  assert.equal(blocked.remaining, 0);
});

test('rateLimit is isolated per key (per-tenant): one key blocked does not block another', () => {
  __resetRateLimit('t2');
  const bucket = { windowMs: 60_000, max: 1 };
  assert.equal(rateLimit('t2', 'tenantA', bucket).ok, true);
  assert.equal(rateLimit('t2', 'tenantA', bucket).ok, false); // A is now blocked
  // A different tenant key must still be allowed — the cross-tenant isolation property.
  assert.equal(rateLimit('t2', 'tenantB', bucket).ok, true);
});

test('rateLimit is isolated per limiter name', () => {
  __resetRateLimit();
  const bucket = { windowMs: 60_000, max: 1 };
  assert.equal(rateLimit('help', 'k', bucket).ok, true);
  assert.equal(rateLimit('help', 'k', bucket).ok, false);
  // Same key, different limiter namespace → independent window.
  assert.equal(rateLimit('assets', 'k', bucket).ok, true);
});

test('rateLimit frees up after the window elapses', async () => {
  __resetRateLimit('t3');
  const bucket = { windowMs: 20, max: 1 };
  assert.equal(rateLimit('t3', 'a', bucket).ok, true);
  assert.equal(rateLimit('t3', 'a', bucket).ok, false);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(rateLimit('t3', 'a', bucket).ok, true); // window slid past the first hit
});

test('blocked requests do not extend the penalty (not counted)', () => {
  __resetRateLimit('t4');
  const bucket = { windowMs: 60_000, max: 1 };
  assert.equal(rateLimit('t4', 'a', bucket).ok, true);
  // Hammer while blocked — none of these should be recorded as new hits.
  const r1 = rateLimit('t4', 'a', bucket);
  const r2 = rateLimit('t4', 'a', bucket);
  // retryAfter should reflect the original hit's window, not keep growing.
  assert.equal(r1.ok, false);
  assert.equal(r2.ok, false);
  assert.ok(r2.retryAfterSec <= r1.retryAfterSec + 1);
});
