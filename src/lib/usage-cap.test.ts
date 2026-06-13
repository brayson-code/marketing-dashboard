import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isOverBudget,
  shouldWarn,
  envEnforcementOn,
  BudgetExceededError,
  DEFAULT_DAILY_TOKENS,
  WARN_FRACTION,
} from './usage-cap';

// These tests cover the PURE decision surface (no DB / no network). The DB-bound
// functions (getUsageCap/setUsageCap/getTodayTokenUsage/assertWithinBudget) are
// thin wrappers over the same helpers + tenant-scoped SQL, exercised in staging.

// ── isOverBudget: the core block decision ────────────────────────────────────

test('isOverBudget: under the cap → not blocked', () => {
  assert.equal(isOverBudget(100, 1000, true, true), false);
});

test('isOverBudget: exactly AT the cap → blocked (>= boundary)', () => {
  assert.equal(isOverBudget(1000, 1000, true, true), true);
});

test('isOverBudget: over the cap → blocked', () => {
  assert.equal(isOverBudget(1500, 1000, true, true), true);
});

test('isOverBudget: estimated headroom pushes a near-cap spawn over', () => {
  // used 900, cap 1000, but this call estimates 200 → projected 1100 ≥ 1000 → block
  assert.equal(isOverBudget(900, 1000, true, true, 200), true);
  // same usage with no estimate is still under → allow
  assert.equal(isOverBudget(900, 1000, true, true, 0), false);
});

test('isOverBudget: negative estimate is clamped to 0 (never relaxes the gate)', () => {
  assert.equal(isOverBudget(900, 1000, true, true, -5000), false);
  assert.equal(isOverBudget(1000, 1000, true, true, -5000), true);
});

// ── enforcement-off no-ops (both kill switches) ──────────────────────────────

test('isOverBudget: env kill switch OFF → never blocks even when way over', () => {
  assert.equal(isOverBudget(9_999_999, 1000, true, /* envOn */ false), false);
});

test('isOverBudget: tenant cap disabled → never blocks even when way over', () => {
  assert.equal(isOverBudget(9_999_999, 1000, /* enabled */ false, true), false);
});

test('isOverBudget: non-positive cap → never blocks (treated as unconfigured)', () => {
  assert.equal(isOverBudget(9_999_999, 0, true, true), false);
  assert.equal(isOverBudget(9_999_999, -1, true, true), false);
});

test('isOverBudget: both switches must be ON to ever block', () => {
  assert.equal(isOverBudget(2000, 1000, false, false), false);
  assert.equal(isOverBudget(2000, 1000, true, false), false);
  assert.equal(isOverBudget(2000, 1000, false, true), false);
  assert.equal(isOverBudget(2000, 1000, true, true), true);
});

// ── shouldWarn: the 80% boundary ─────────────────────────────────────────────

test('shouldWarn: below 80% → no warn', () => {
  // 79% of 1000 = 790
  assert.equal(shouldWarn(789, 1000, true), false);
});

test('shouldWarn: exactly at the 80% boundary → warn', () => {
  assert.equal(WARN_FRACTION, 0.8);
  assert.equal(shouldWarn(800, 1000, true), true);
});

test('shouldWarn: between 80% and 100% → warn', () => {
  assert.equal(shouldWarn(950, 1000, true), true);
});

test('shouldWarn: AT the cap → do NOT warn (we block instead, separate signal)', () => {
  assert.equal(shouldWarn(1000, 1000, true), false);
});

test('shouldWarn: over the cap → do NOT warn (block path owns it)', () => {
  assert.equal(shouldWarn(1200, 1000, true), false);
});

test('shouldWarn: disabled tenant or non-positive cap → never warn', () => {
  assert.equal(shouldWarn(900, 1000, false), false);
  assert.equal(shouldWarn(900, 0, true), false);
});

// ── BudgetExceededError carries the right fields ─────────────────────────────

test('BudgetExceededError carries tenantId / usedToday / cap / remaining', () => {
  const err = new BudgetExceededError({
    tenantId: 'tenant-abc',
    usedToday: 2_100_000,
    cap: 2_000_000,
    remaining: 0,
  });
  assert.ok(err instanceof Error);
  assert.ok(err instanceof BudgetExceededError);
  assert.equal(err.code, 'BUDGET_EXCEEDED');
  assert.equal(err.name, 'BudgetExceededError');
  assert.equal(err.tenantId, 'tenant-abc');
  assert.equal(err.usedToday, 2_100_000);
  assert.equal(err.cap, 2_000_000);
  assert.equal(err.remaining, 0);
  // Message is human-readable and mentions the tenant + numbers.
  assert.match(err.message, /tenant-abc/);
});

test('BudgetExceededError is distinguishable from a generic Error (instanceof gate)', () => {
  const budget: unknown = new BudgetExceededError({ tenantId: 't', usedToday: 5, cap: 4, remaining: 0 });
  const generic: unknown = new Error('boom');
  assert.equal(budget instanceof BudgetExceededError, true);
  assert.equal(generic instanceof BudgetExceededError, false);
});

// ── env kill switch reading ──────────────────────────────────────────────────

test('envEnforcementOn: default ON when unset', () => {
  delete process.env.USAGE_CAP_ENFORCE;
  assert.equal(envEnforcementOn(), true);
});

test('envEnforcementOn: only the exact string "false" disables it', () => {
  process.env.USAGE_CAP_ENFORCE = 'false';
  assert.equal(envEnforcementOn(), false);
  process.env.USAGE_CAP_ENFORCE = 'true';
  assert.equal(envEnforcementOn(), true);
  process.env.USAGE_CAP_ENFORCE = '0'; // not 'false' → still ON (fail-safe to enforce)
  assert.equal(envEnforcementOn(), true);
  delete process.env.USAGE_CAP_ENFORCE;
});

// ── default sizing sanity ────────────────────────────────────────────────────

test('DEFAULT_DAILY_TOKENS is a generous 2M (matches usage.ts display default)', () => {
  assert.equal(DEFAULT_DAILY_TOKENS, 2_000_000);
});
