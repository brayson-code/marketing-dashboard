import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  accrualStatus, upcomingHolidays, holidaysFor, ENTITLEMENTS, PROBATION_MONTHS,
} from './service-policy';

// The accrual maths is the one part of the portal a client could be told something
// wrong by. "You have 4 vacation days" when they have 0 available is a real
// conversation with a real client, so the edge cases are pinned here.

const at = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();

test('day one: nothing accrued, probation running', () => {
  const s = accrualStatus('2026-01-15', at('2026-01-15'))!;
  assert.equal(s.monthsElapsed, 0);
  assert.equal(s.inProbation, true);
  assert.equal(s.probationEndsOn, '2026-04-15');
  assert.equal(s.accrued.vacation, 0);
  assert.equal(s.available.vacation, 0);
});

test('accrues DURING probation but nothing is available yet', () => {
  // Two months in: 2/12 of 10 days = 1.7 accrued, still nothing usable.
  const s = accrualStatus('2026-01-15', at('2026-03-20'))!;
  assert.equal(s.monthsElapsed, 2);
  assert.equal(s.inProbation, true);
  assert.equal(s.accrued.vacation, 1.7);
  assert.equal(s.available.vacation, 0, 'no paid leave inside probation');
});

test('the day probation ends, everything accrued becomes available', () => {
  const s = accrualStatus('2026-01-15', at('2026-04-15'))!;
  assert.equal(s.inProbation, false);
  assert.equal(s.daysToProbationEnd, 0);
  assert.equal(s.accrued.vacation, 2.5);
  assert.equal(s.available.vacation, 2.5, 'accrued during probation, usable after');
});

test('probation is exactly PROBATION_MONTHS, not 90 days', () => {
  // Feb is short; a 90-day rule would land differently than a 3-month one.
  const s = accrualStatus('2026-01-31', at('2026-02-01'))!;
  assert.equal(s.probationEndsOn, '2026-04-30', 'clamps a rolled-over short month');
  assert.equal(PROBATION_MONTHS, 3);
});

test('entitlement caps at one year and does not compound', () => {
  const oneYear = accrualStatus('2025-01-15', at('2026-01-15'))!;
  const threeYears = accrualStatus('2023-01-15', at('2026-01-15'))!;
  for (const e of ENTITLEMENTS) {
    assert.equal(oneYear.accrued[e.kind], e.daysPerYear);
    assert.equal(threeYears.accrued[e.kind], e.daysPerYear, 'resets annually');
  }
});

test('all three leave kinds accrue on the same clock', () => {
  const s = accrualStatus('2026-01-15', at('2026-07-15'))!;
  assert.equal(s.accrued.vacation, 5);   // 6/12 of 10
  assert.equal(s.accrued.sick, 2.5);     // 6/12 of 5
  assert.equal(s.accrued.emergency, 2.5);
});

test('a missing or malformed start date returns null rather than guessing', () => {
  assert.equal(accrualStatus('', at('2026-07-15')), null);
  assert.equal(accrualStatus('not-a-date', at('2026-07-15')), null);
  assert.equal(accrualStatus('15/01/2026', at('2026-07-15')), null);
});

test('holiday lists differ by region and Christmas is in both', () => {
  const ca = holidaysFor('CA');
  const us = holidaysFor('US');
  assert.ok(ca.some(h => h.name === 'Canada Day'));
  assert.ok(!us.some(h => h.name === 'Canada Day'));
  assert.ok(us.some(h => h.name === 'Juneteenth'));
  assert.ok(!ca.some(h => h.name === 'Juneteenth'));
  for (const list of [ca, us]) {
    assert.ok(list.some(h => h.name === 'Christmas Day'), 'the one PH holiday observed');
  }
});

test('upcoming holidays are forward-looking, and today counts as upcoming', () => {
  // On the day itself: still listed. A holiday shouldn't vanish from "upcoming" at
  // midnight on the morning the client most needs to know about it.
  assert.deepEqual(
    upcomingHolidays('CA', at('2026-11-11'), 4).map(h => h.name),
    ['Remembrance Day / Veterans Day', 'Christmas Day', 'Boxing Day'],
  );
  // Four days later it has passed and drops off.
  assert.deepEqual(
    upcomingHolidays('CA', at('2026-11-15'), 4).map(h => h.name),
    ['Christmas Day', 'Boxing Day'],
  );
});
