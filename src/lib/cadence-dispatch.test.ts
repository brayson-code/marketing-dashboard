import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  eligibility,
  OUTREACH_ELIGIBLE_STATUSES,
  type EligibilityLead,
  type EligibilityStep,
} from './cadence-dispatch';

// A baseline lead/step that, with both switches ON + an inbox, should SEND.
const okLead: EligibilityLead = { email: 'lead@example.com', status: 'approved', pause_outreach: false };
const approvedStep: EligibilityStep = { status: 'approved' };

// ── Both kill switches must be on (rollback-critical) ─────────────────────────

test('env OFF → skip:disabled (engine ships inert)', () => {
  assert.equal(eligibility(okLead, approvedStep, true, false, true), 'skip:disabled');
});

test('tenant OFF → skip:disabled', () => {
  assert.equal(eligibility(okLead, approvedStep, true, true, false), 'skip:disabled');
});

test('both OFF → skip:disabled', () => {
  assert.equal(eligibility(okLead, approvedStep, true, false, false), 'skip:disabled');
});

test('disabled takes priority over every other gate', () => {
  const bad: EligibilityLead = { email: null, status: 'rejected', pause_outreach: true };
  assert.equal(eligibility(bad, { status: 'pending_approval' }, false, false, false), 'skip:disabled');
});

// ── Content safety: only owner-approved steps ────────────────────────────────

test('un-approved step → skip:not_approved (never send unapproved content)', () => {
  for (const status of ['pending_approval', 'queued', 'cancelled', 'sent', null]) {
    assert.equal(
      eligibility(okLead, { status }, true, true, true),
      'skip:not_approved',
      `status=${status}`,
    );
  }
});

// ── Inbox / key ──────────────────────────────────────────────────────────────

test('no inbox/key → skip:no_inbox', () => {
  assert.equal(eligibility(okLead, approvedStep, false, true, true), 'skip:no_inbox');
});

// ── Per-lead gates ───────────────────────────────────────────────────────────

test('paused lead → skip:paused (bool true and legacy 1)', () => {
  assert.equal(
    eligibility({ ...okLead, pause_outreach: true }, approvedStep, true, true, true),
    'skip:paused',
  );
  assert.equal(
    eligibility({ ...okLead, pause_outreach: 1 }, approvedStep, true, true, true),
    'skip:paused',
  );
});

test('no email (null / empty / whitespace) → skip:no_email', () => {
  for (const email of [null, '', '   ']) {
    assert.equal(
      eligibility({ ...okLead, email }, approvedStep, true, true, true),
      'skip:no_email',
      `email=${JSON.stringify(email)}`,
    );
  }
});

test('ineligible lead status → skip:ineligible_status', () => {
  for (const status of ['new', 'validated', 'booked', 'qualified', 'rejected', 'disqualified', null]) {
    assert.equal(
      eligibility({ ...okLead, status }, approvedStep, true, true, true),
      'skip:ineligible_status',
      `status=${status}`,
    );
  }
});

test('every outreach-eligible status sends', () => {
  for (const status of OUTREACH_ELIGIBLE_STATUSES) {
    assert.equal(
      eligibility({ ...okLead, status }, approvedStep, true, true, true),
      'send',
      `status=${status}`,
    );
  }
});

// ── Happy path ───────────────────────────────────────────────────────────────

test('approved step + active lead + inbox + both switches ON → send', () => {
  assert.equal(eligibility(okLead, approvedStep, true, true, true), 'send');
});

test('pause_outreach false/0/null does not block', () => {
  for (const p of [false, 0, null]) {
    assert.equal(
      eligibility({ ...okLead, pause_outreach: p }, approvedStep, true, true, true),
      'send',
      `pause=${JSON.stringify(p)}`,
    );
  }
});

// ── Check ordering: switches before content, content before inbox/lead gates ──

test('check order — not_approved beats inbox/lead gates when switches on', () => {
  // Unapproved + no inbox + paused + no email: should report not_approved first.
  assert.equal(
    eligibility({ email: null, status: 'new', pause_outreach: true }, { status: 'sent' }, false, true, true),
    'skip:not_approved',
  );
});

test('check order — no_inbox beats per-lead gates', () => {
  assert.equal(
    eligibility({ email: null, status: 'new', pause_outreach: true }, approvedStep, false, true, true),
    'skip:no_inbox',
  );
});
