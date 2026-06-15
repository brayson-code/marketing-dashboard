import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isStale, sweepEligibility } from './stale-lead-sweep';

// ── isStale ───────────────────────────────────────────────────────────────────

const NOW = new Date('2026-06-15T13:00:00Z');
const BEFORE = new Date('2026-06-14T10:00:00Z'); // earlier than NOW
const AFTER = new Date('2026-06-15T14:00:00Z');  // later than NOW (future inbound — edge case)

// A lead we touched at NOW.
const touchedLead = { last_touch_at: NOW, pause_outreach: false };
// A lead we have never touched.
const untouchedLead = { last_touch_at: null, pause_outreach: false };
// A paused lead.
const pausedLead = { last_touch_at: null, pause_outreach: true };
const pausedLead1 = { last_touch_at: null, pause_outreach: 1 as boolean | number | null };

// ── No inbound ───────────────────────────────────────────────────────────────

test('isStale: no inbound (null) → false', () => {
  assert.equal(isStale(touchedLead, null), false);
  assert.equal(isStale(untouchedLead, null), false);
});

// ── Paused leads are never stale ─────────────────────────────────────────────

test('isStale: paused lead (bool true) → false even with inbound', () => {
  assert.equal(isStale(pausedLead, NOW), false);
});

test('isStale: paused lead (legacy 1) → false even with inbound', () => {
  assert.equal(isStale(pausedLead1, NOW), false);
});

// ── Untouched leads (last_touch_at null) ─────────────────────────────────────

test('isStale: untouched lead + any inbound → stale (we have never replied)', () => {
  assert.equal(isStale(untouchedLead, BEFORE), true);
  assert.equal(isStale(untouchedLead, NOW), true);
});

// ── Inbound BEFORE our last touch → NOT stale ────────────────────────────────

test('isStale: inbound before last_touch_at → not stale (we already replied)', () => {
  // touchedLead.last_touch_at = NOW; BEFORE < NOW → we replied after them
  assert.equal(isStale(touchedLead, BEFORE), false);
});

// ── Inbound AFTER our last touch → stale ─────────────────────────────────────

test('isStale: inbound after last_touch_at → stale', () => {
  // touchedLead.last_touch_at = NOW; AFTER > NOW → they wrote after our last touch
  assert.equal(isStale(touchedLead, AFTER), true);
});

test('isStale: inbound at exact same ms as last_touch_at → not stale (not strictly after)', () => {
  assert.equal(isStale(touchedLead, NOW), false);
});

// ── Date strings (DB returns ISO strings) ────────────────────────────────────

test('isStale: accepts ISO string dates', () => {
  const lead = { last_touch_at: '2026-06-14T10:00:00Z', pause_outreach: false };
  assert.equal(isStale(lead, '2026-06-15T08:00:00Z'), true);
  assert.equal(isStale(lead, '2026-06-13T08:00:00Z'), false);
});

// ── sweepEligibility ──────────────────────────────────────────────────────────

const okLead = { last_touch_at: NOW, pause_outreach: false };
const staleLead = { last_touch_at: NOW, pause_outreach: false };
const staleInbound = AFTER; // inbound after last_touch_at → stale

// Kill switches.

test('sweepEligibility: env OFF → skip:disabled_env (engine ships inert)', () => {
  assert.equal(sweepEligibility(staleLead, staleInbound, false, true), 'skip:disabled_env');
});

test('sweepEligibility: tenant OFF → skip:disabled_tenant', () => {
  assert.equal(sweepEligibility(staleLead, staleInbound, true, false), 'skip:disabled_tenant');
});

test('sweepEligibility: both OFF → skip:disabled_env (env checked first)', () => {
  assert.equal(sweepEligibility(staleLead, staleInbound, false, false), 'skip:disabled_env');
});

// Paused.

test('sweepEligibility: paused lead → skip:paused (after kill-switch checks)', () => {
  assert.equal(
    sweepEligibility({ last_touch_at: null, pause_outreach: true }, staleInbound, true, true),
    'skip:paused',
  );
});

test('sweepEligibility: paused lead (legacy 1) → skip:paused', () => {
  assert.equal(
    sweepEligibility({ last_touch_at: null, pause_outreach: 1 as boolean | number | null }, staleInbound, true, true),
    'skip:paused',
  );
});

// No inbound.

test('sweepEligibility: no inbound → skip:no_inbound', () => {
  assert.equal(sweepEligibility(okLead, null, true, true), 'skip:no_inbound');
});

// Not stale.

test('sweepEligibility: inbound before last_touch_at → skip:not_stale', () => {
  assert.equal(sweepEligibility(touchedLead, BEFORE, true, true), 'skip:not_stale');
});

// Happy path.

test('sweepEligibility: stale lead, both switches ON → draft', () => {
  assert.equal(sweepEligibility(staleLead, staleInbound, true, true), 'draft');
});

test('sweepEligibility: untouched lead + inbound → draft', () => {
  assert.equal(sweepEligibility(untouchedLead, BEFORE, true, true), 'draft');
});

// Priority ordering.

test('sweepEligibility: env OFF takes priority over paused + no_inbound', () => {
  assert.equal(
    sweepEligibility({ last_touch_at: null, pause_outreach: true }, null, false, true),
    'skip:disabled_env',
  );
});

test('sweepEligibility: tenant OFF takes priority over paused', () => {
  assert.equal(
    sweepEligibility({ last_touch_at: null, pause_outreach: true }, staleInbound, true, false),
    'skip:disabled_tenant',
  );
});

test('sweepEligibility: paused takes priority over no_inbound', () => {
  assert.equal(
    sweepEligibility({ last_touch_at: null, pause_outreach: true }, null, true, true),
    'skip:paused',
  );
});
