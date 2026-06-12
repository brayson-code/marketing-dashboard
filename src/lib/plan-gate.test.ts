import assert from 'node:assert/strict';
import { test } from 'node:test';

// planAllowsKg is a pure function: test it without a real DB.
// We set DEFAULT_TENANT_ID via env BEFORE importing so the module picks it up.
const HQ_ID = 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';
process.env.DEFAULT_TENANT_ID = HQ_ID;

import { planAllowsKg } from './plan-gate';

const SOME_CLIENT = 'aaaaaaaa-0000-0000-0000-000000000001';

test('HQ tenant always passes regardless of plan', () => {
  assert.equal(planAllowsKg('lite', HQ_ID), true);
  assert.equal(planAllowsKg('free', HQ_ID), true);
  assert.equal(planAllowsKg('pro', HQ_ID), true);
  assert.equal(planAllowsKg('starter', HQ_ID), true);
  assert.equal(planAllowsKg('unknown_future_plan', HQ_ID), true);
});

test('pro plan passes for a client tenant', () => {
  assert.equal(planAllowsKg('pro', SOME_CLIENT), true);
});

test('lite plan is blocked for a client tenant', () => {
  assert.equal(planAllowsKg('lite', SOME_CLIENT), false);
});

test('free plan is blocked for a client tenant', () => {
  assert.equal(planAllowsKg('free', SOME_CLIENT), false);
});

test('starter (legacy lite) plan is blocked for a client tenant', () => {
  assert.equal(planAllowsKg('starter', SOME_CLIENT), false);
});

test('unknown plan is blocked (fail closed) for a client tenant', () => {
  assert.equal(planAllowsKg('enterprise', SOME_CLIENT), false);
  assert.equal(planAllowsKg('', SOME_CLIENT), false);
});
