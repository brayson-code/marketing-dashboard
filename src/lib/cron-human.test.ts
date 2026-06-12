import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cronToHuman, SCHEDULE_PRESETS } from './cron-human';

// ── Core expressions ──────────────────────────────────────────────────────────

test('Daily at 9:00', () => {
  assert.equal(cronToHuman('0 9 * * *'), 'Daily at 9:00');
});

test('Daily at 14:30', () => {
  assert.equal(cronToHuman('30 14 * * *'), 'Daily at 14:30');
});

test('Every hour (0 * * * *)', () => {
  assert.equal(cronToHuman('0 * * * *'), 'Every hour');
});

test('Hourly at :15', () => {
  assert.equal(cronToHuman('15 * * * *'), 'Hourly at :15');
});

test('Every 15 min', () => {
  assert.equal(cronToHuman('*/15 * * * *'), 'Every 15 min');
});

test('Mondays at 9:00', () => {
  assert.equal(cronToHuman('0 9 * * 1'), 'Mondays at 9:00');
});

test('Weekdays at 9:00', () => {
  assert.equal(cronToHuman('0 9 * * 1-5'), 'Weekdays at 9:00');
});

test('Mon, Wed, Fri at 9:00', () => {
  assert.equal(cronToHuman('0 9 * * 1,3,5'), 'Mon, Wed, Fri at 9:00');
});

test('Monthly on the 1st at 9:00', () => {
  assert.equal(cronToHuman('0 9 1 * *'), 'Monthly on the 1st at 9:00');
});

test('Every 2 days at 9:00', () => {
  assert.equal(cronToHuman('0 9 */2 * *'), 'Every 2 days at 9:00');
});

// ── Unparseable / unknown — return raw expr ───────────────────────────────────

test('unparseable: 6-field cron returns raw', () => {
  const raw = '0 9 * * * *';
  assert.equal(cronToHuman(raw), raw);
});

test('unparseable: empty string returns empty', () => {
  assert.equal(cronToHuman(''), '');
});

test('unparseable: range in hour field returns raw', () => {
  const raw = '0 9-17 * * *';
  assert.equal(cronToHuman(raw), raw);
});

test('unparseable: non-numeric day-of-month returns raw', () => {
  const raw = '0 9 L * *';
  assert.equal(cronToHuman(raw), raw);
});

// ── Timezone label appended when non-UTC ─────────────────────────────────────

test('timezone appended for non-UTC tz', () => {
  assert.equal(cronToHuman('0 9 * * *', 'America/New_York'), 'Daily at 9:00 (New York)');
});

test('timezone NOT appended for UTC', () => {
  assert.equal(cronToHuman('0 9 * * *', 'UTC'), 'Daily at 9:00');
});

test('timezone NOT appended when tz is omitted', () => {
  assert.equal(cronToHuman('0 9 * * *'), 'Daily at 9:00');
});

test('timezone appended for weekdays expr with tz', () => {
  assert.equal(cronToHuman('0 9 * * 1-5', 'America/Los_Angeles'), 'Weekdays at 9:00 (Los Angeles)');
});

// ── Edge: midnight and noon ───────────────────────────────────────────────────

test('Daily at midnight (0 0 * * *)', () => {
  assert.equal(cronToHuman('0 0 * * *'), 'Daily at 0:00'); // no leading zero on hour
});

test('Daily at noon (0 12 * * *)', () => {
  assert.equal(cronToHuman('0 12 * * *'), 'Daily at 12:00');
});

// ── SCHEDULE_PRESETS sanity ───────────────────────────────────────────────────

test('SCHEDULE_PRESETS has 5 entries', () => {
  assert.equal(SCHEDULE_PRESETS.length, 5);
});

test('SCHEDULE_PRESETS[0] is Every hour', () => {
  assert.equal(SCHEDULE_PRESETS[0].label, 'Every hour');
  assert.equal(SCHEDULE_PRESETS[0].expr, '0 * * * *');
});

test('SCHEDULE_PRESETS all exprs round-trip through cronToHuman', () => {
  for (const p of SCHEDULE_PRESETS) {
    const human = cronToHuman(p.expr);
    // Must not return the raw expr unchanged (each preset must match a pattern)
    assert.notEqual(human, p.expr, `Preset "${p.label}" returned raw expr unchanged`);
  }
});

// ── Ordinal suffixes ──────────────────────────────────────────────────────────

test('Monthly on the 2nd', () => {
  assert.equal(cronToHuman('0 9 2 * *'), 'Monthly on the 2nd at 9:00');
});

test('Monthly on the 3rd', () => {
  assert.equal(cronToHuman('0 9 3 * *'), 'Monthly on the 3rd at 9:00');
});

test('Monthly on the 11th', () => {
  assert.equal(cronToHuman('0 9 11 * *'), 'Monthly on the 11th at 9:00');
});

test('Monthly on the 15th', () => {
  assert.equal(cronToHuman('0 9 15 * *'), 'Monthly on the 15th at 9:00');
});
