import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readiness, urgency, type WorkspaceFacts } from './readiness';

const base: WorkspaceFacts = {
  status: 'provisioned',
  capturedAt: null,
  essentialsFilled: 0,
  essentialsTotal: 6,
  hasAssistantName: false,
  hasStartDate: false,
  members: 0,
  hasAssistantLogin: false,
  goLiveOn: '2026-09-01',
};

const full: WorkspaceFacts = {
  ...base,
  status: 'active',
  capturedAt: '2026-08-01T00:00:00Z',
  essentialsFilled: 6,
  hasAssistantName: true,
  hasStartDate: true,
  members: 2,
  hasAssistantLogin: true,
};

test('a brand new workspace is not ready and says what to do first', () => {
  const r = readiness(base);
  assert.equal(r.ready, false);
  assert.equal(r.done, 0);
  assert.match(r.nextAction!, /Onboarding call captured/);
});

test('a fully set up workspace is ready and has nothing left', () => {
  const r = readiness(full);
  assert.equal(r.ready, true);
  assert.equal(r.done, r.total);
  assert.equal(r.nextAction, null);
});

test('a PARTIAL capture is not a capture, and says how much is left', () => {
  const r = readiness({ ...base, capturedAt: '2026-08-01T00:00:00Z', essentialsFilled: 4 });
  assert.equal(r.steps[0].done, false);
  assert.match(r.steps[0].detail!, /2 of 6 essentials still blank/);
});

test('a start date missing is called out specifically, because leave depends on it', () => {
  const r = readiness({ ...full, hasStartDate: false });
  const step = r.steps.find(s => s.key === 'assistant')!;
  assert.equal(step.done, false);
  assert.match(step.detail!, /leave cannot be calculated/);
});

test('a client login with no assistant login is flagged but does not block', () => {
  const r = readiness({ ...full, hasAssistantLogin: false });
  const step = r.steps.find(s => s.key === 'logins')!;
  assert.equal(step.done, true, 'someone can sign in, so the step is done');
  assert.match(step.detail!, /no assistant login/);
});

test('being OPEN does not make a workspace ready — this is the exact production state', () => {
  // All 14 live workspaces are active with nothing captured. "Open" must not read as
  // "done", or the checklist would agree that everything is fine.
  const r = readiness({ ...base, status: 'active', members: 1 });
  assert.equal(r.steps.find(s => s.key === 'open')!.done, true);
  assert.equal(r.ready, false, 'open but empty is NOT ready');
  assert.match(r.nextAction!, /Onboarding call captured/);
});

test('live and unfinished sorts above everything else', () => {
  const liveBad = { ...base, status: 'active' as const, members: 1 };
  const pendingBad = base;
  const good = full;
  assert.ok(urgency(liveBad, readiness(liveBad)) < urgency(pendingBad, readiness(pendingBad)));
  assert.ok(urgency(pendingBad, readiness(pendingBad)) < urgency(good, readiness(good)));
});

test('only one next action is ever offered', () => {
  const r = readiness(base);
  assert.equal(typeof r.nextAction, 'string');
  assert.ok(!r.nextAction!.includes('\n'), 'a list of four things is how this got here');
});
