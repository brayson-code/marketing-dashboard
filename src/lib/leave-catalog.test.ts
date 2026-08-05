import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workingDays, remaining, checkRequest, type LeaveRequest } from './leave-catalog';

const MON_FRI = ['mon', 'tue', 'wed', 'thu', 'fri'];

// 2026-08-03 is a Monday.
test('a working week is five days, not seven', () => {
  assert.equal(workingDays('2026-08-03', '2026-08-07', MON_FRI), 5);
  assert.equal(workingDays('2026-08-03', '2026-08-09', MON_FRI), 5, 'the weekend is not leave');
});

test('a single day is one day', () => {
  assert.equal(workingDays('2026-08-05', '2026-08-05', MON_FRI), 1);
});

test('a weekend-only request is zero days, not a free day off', () => {
  assert.equal(workingDays('2026-08-08', '2026-08-09', MON_FRI), 0);
});

test("it counts against the assistant's OWN days, not Monday to Friday", () => {
  // Someone working Tue–Sat should not lose a Saturday they never worked, and should
  // not gain a free Monday either.
  const TUE_SAT = ['tue', 'wed', 'thu', 'fri', 'sat'];
  assert.equal(workingDays('2026-08-03', '2026-08-09', TUE_SAT), 5);
  assert.equal(workingDays('2026-08-03', '2026-08-03', TUE_SAT), 0, 'Monday is not their day');
});

test('backwards or malformed dates are zero, never negative', () => {
  assert.equal(workingDays('2026-08-09', '2026-08-03', MON_FRI), 0);
  assert.equal(workingDays('nonsense', '2026-08-03', MON_FRI), 0);
});

function req(over: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 'r', kind: 'vacation', starts_on: '2026-09-01', ends_on: '2026-09-02',
    days: 2, note: null, status: 'approved', unpaid: false, requester_email: null,
    decided_by: null, decided_at: null, decision_note: null, created_at: '',
    ...over,
  } as LeaveRequest;
}

test('PENDING requests count against the balance', () => {
  // Otherwise someone can request their whole allowance three times before anyone
  // approves the first one.
  const r = remaining({
    accrued: 10, kind: 'vacation',
    requests: [req({ status: 'pending', days: 3 })],
  });
  assert.equal(r, 7);
});

test('declined and cancelled requests do not', () => {
  const r = remaining({
    accrued: 10, kind: 'vacation',
    requests: [req({ status: 'declined', days: 3 }), req({ status: 'cancelled', days: 4 })],
  });
  assert.equal(r, 10);
});

test('unpaid days are not drawn from the entitlement', () => {
  const r = remaining({
    accrued: 10, kind: 'vacation',
    requests: [req({ days: 5, unpaid: true })],
  });
  assert.equal(r, 10, 'unpaid leave was never taken from the balance');
});

test('kinds do not bleed into each other', () => {
  const r = remaining({
    accrued: 10, kind: 'vacation',
    requests: [req({ kind: 'sick', days: 4 })],
  });
  assert.equal(r, 10);
});

test('probation makes a request unpaid, it does not refuse it', () => {
  const c = checkRequest({ days: 3, startsOn: '2026-09-01', inProbation: true, remaining: 0, today: '2026-08-05' });
  assert.equal(c.ok, true, 'the client is entitled to say yes');
  assert.equal(c.unpaid, true);
  assert.match(c.warning!, /unpaid/);
  assert.match(c.warning!, /made up/, 'the make-up-the-hours rule must be stated');
});

test('over-requesting warns but does not block', () => {
  const c = checkRequest({ days: 5, startsOn: '2026-09-01', inProbation: false, remaining: 2, today: '2026-08-05' });
  assert.equal(c.ok, true);
  assert.match(c.warning!, /3 day/);
});

test('genuine nonsense IS refused', () => {
  assert.equal(checkRequest({ days: 0, startsOn: '2026-09-01', inProbation: false, remaining: 5, today: '2026-08-05' }).ok, false);
  assert.equal(checkRequest({ days: 2, startsOn: '2026-08-01', inProbation: false, remaining: 5, today: '2026-08-05' }).ok, false);
});

test('a request within balance passes silently', () => {
  const c = checkRequest({ days: 2, startsOn: '2026-09-01', inProbation: false, remaining: 5, today: '2026-08-05' });
  assert.deepEqual(c, { ok: true, unpaid: false });
});
