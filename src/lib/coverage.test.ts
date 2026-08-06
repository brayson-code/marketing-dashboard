import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coverage, nextAbsence } from './coverage';
import type { LeaveRequest } from './leave-catalog';

// 2026-08-05 is a Wednesday. Canadian holidays in range: Labour Day 7 Sep,
// Thanksgiving 12 Oct, Remembrance Day 11 Nov.
const NOW = Date.parse('2026-08-05T12:00:00Z');

function leave(over: Partial<LeaveRequest>): LeaveRequest {
  return {
    id: 'l1', kind: 'vacation', starts_on: '2026-09-14', ends_on: '2026-09-18',
    days: 5, note: null, status: 'approved', unpaid: false, requester_email: null,
    decided_by: null, decided_at: null, decision_note: null, created_at: '',
    ...over,
  } as LeaveRequest;
}

test('approved leave and holidays land in the same list', () => {
  const m = coverage({ requests: [leave({})], region: 'CA', now: NOW });
  const all = m.flatMap(x => x.absences);
  assert.ok(all.some(a => a.kind === 'leave'));
  assert.ok(all.some(a => a.kind === 'holiday'));
});

test('a PENDING request is a question, not a plan, and never shows', () => {
  // Showing it would have a founder planning around time off they have not agreed to.
  const m = coverage({ requests: [leave({ status: 'pending' })], region: 'CA', now: NOW });
  assert.equal(m.flatMap(x => x.absences).filter(a => a.kind === 'leave').length, 0);
});

test('declined and cancelled leave never shows either', () => {
  for (const status of ['declined', 'cancelled'] as const) {
    const m = coverage({ requests: [leave({ status })], region: 'CA', now: NOW });
    assert.equal(m.flatMap(x => x.absences).filter(a => a.kind === 'leave').length, 0, status);
  }
});

test('leave already underway still counts as an absence', () => {
  // Started last week, ends next Tuesday. They are still away.
  const m = coverage({
    requests: [leave({ starts_on: '2026-08-01', ends_on: '2026-08-11' })],
    region: 'CA', now: NOW,
  });
  assert.equal(m.flatMap(x => x.absences).filter(a => a.kind === 'leave').length, 1);
});

test('leave that finished before today is gone', () => {
  const m = coverage({
    requests: [leave({ starts_on: '2026-07-01', ends_on: '2026-07-05' })],
    region: 'CA', now: NOW,
  });
  assert.equal(m.flatMap(x => x.absences).filter(a => a.kind === 'leave').length, 0);
});

test('grouped by month, in order, with days totalled', () => {
  const m = coverage({ requests: [leave({})], region: 'CA', now: NOW });
  const keys = m.map(x => x.key);
  assert.deepEqual([...keys].sort(), keys, 'months must be chronological');
  const sept = m.find(x => x.key === '2026-09')!;
  // 5 days of leave + Labour Day.
  assert.equal(sept.days, 6);
  assert.match(sept.label, /September 2026/);
});

test('the horizon keeps a year of holidays from burying next week', () => {
  const short = coverage({ requests: [], region: 'CA', now: NOW, horizonDays: 40 });
  const long = coverage({ requests: [], region: 'CA', now: NOW, horizonDays: 200 });
  assert.ok(short.flatMap(x => x.absences).length < long.flatMap(x => x.absences).length);
});

test('the region decides which holidays appear', () => {
  const ca = coverage({ requests: [], region: 'CA', now: NOW }).flatMap(m => m.absences).map(a => a.label);
  const us = coverage({ requests: [], region: 'US', now: NOW }).flatMap(m => m.absences).map(a => a.label);
  assert.ok(ca.some(l => l.includes('Thanksgiving (CA)')));
  assert.ok(!us.some(l => l.includes('Thanksgiving (CA)')));
});

test('unpaid leave is carried through so it can be shown as such', () => {
  const m = coverage({ requests: [leave({ unpaid: true })], region: 'CA', now: NOW });
  assert.equal(m.flatMap(x => x.absences).find(a => a.kind === 'leave')!.unpaid, true);
});

test('a clear horizon has no next absence', () => {
  assert.equal(nextAbsence([]), null);
  const m = coverage({ requests: [leave({})], region: 'CA', now: NOW });
  assert.ok(nextAbsence(m));
});
