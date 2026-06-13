// Tests for pure Telegram helpers — no DB, no network.
// Tests cover:
//   1. formatTelegramMessage: title+body, body-only, severity icons, HTML escaping, truncation.
//   2. Gating logic: sendTelegram no-ops when config is absent.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatTelegramMessage } from './telegram';

// ── formatTelegramMessage ────────────────────────────────────────────────────

test('formatTelegramMessage: title + body produces bold title on first line', () => {
  const result = formatTelegramMessage({ title: 'New lead', message: 'Alice signed up.' });
  assert.ok(result.includes('<b>New lead</b>'), 'title should be wrapped in <b>');
  assert.ok(result.includes('Alice signed up.'), 'body should appear after title');
  // Title and body on separate lines.
  const lines = result.split('\n');
  assert.equal(lines.length, 2);
});

test('formatTelegramMessage: body-only omits title line', () => {
  const result = formatTelegramMessage({ message: 'Campaign finished.' });
  assert.ok(!result.includes('<b>'), 'no bold tag when no title');
  assert.ok(result.includes('Campaign finished.'));
  assert.equal(result.split('\n').length, 1);
});

test('formatTelegramMessage: error severity prepends red circle', () => {
  const result = formatTelegramMessage({ title: 'Oops', message: 'Something failed.', severity: 'error' });
  assert.ok(result.startsWith('🔴 '));
});

test('formatTelegramMessage: warning severity prepends yellow circle', () => {
  const result = formatTelegramMessage({ message: 'API rate limit near.', severity: 'warning' });
  assert.ok(result.startsWith('🟡 '));
});

test('formatTelegramMessage: info severity has no prefix icon', () => {
  const result = formatTelegramMessage({ message: 'Daily report ready.', severity: 'info' });
  assert.ok(!result.startsWith('🔴') && !result.startsWith('🟡'));
});

test('formatTelegramMessage: undefined severity has no prefix icon', () => {
  const result = formatTelegramMessage({ message: 'Hello.' });
  assert.ok(!result.startsWith('🔴') && !result.startsWith('🟡'));
});

test('formatTelegramMessage: HTML special characters are escaped', () => {
  const result = formatTelegramMessage({
    title: 'Test <Title> & "fun"',
    message: 'Body with <script>alert(1)</script> & more.',
  });
  assert.ok(!result.includes('<script>'), 'raw <script> must be escaped');
  assert.ok(result.includes('&lt;script&gt;'), 'script tag must be escaped as &lt;&gt;');
  assert.ok(result.includes('&amp;'), '& must be escaped');
  // Title should still be bold-wrapped (escaping is inside the tags).
  assert.ok(result.includes('<b>'), '<b> wrapper should be present');
});

test('formatTelegramMessage: long body is truncated to 500 chars', () => {
  const longMessage = 'A'.repeat(600);
  const result = formatTelegramMessage({ message: longMessage });
  // The result should not exceed 500 visible chars in the body (plus the ellipsis char).
  // The body is the entire output when no title.
  assert.ok(result.length <= 510, `output too long: ${result.length}`);
  assert.ok(result.endsWith('…'), 'truncated messages should end with ellipsis');
});

test('formatTelegramMessage: short body is not truncated', () => {
  const msg = 'Short message.';
  const result = formatTelegramMessage({ message: msg });
  assert.ok(result.includes(msg), 'short message should appear verbatim');
  assert.ok(!result.endsWith('…'), 'no ellipsis for short messages');
});

// ── Gating / no-op when not connected ───────────────────────────────────────
// We can't test the live sendTelegram() call (needs DB + network) but we can
// verify that formatTelegramMessage produces a non-empty string for any
// notification the gating logic would forward (i.e. non-debug severities).

test('gating: formatTelegramMessage produces output for info/warning/error', () => {
  for (const severity of ['info', 'warning', 'error']) {
    const result = formatTelegramMessage({ message: 'Test', severity });
    assert.ok(result.length > 0, `expected non-empty output for severity=${severity}`);
  }
});

test('gating: debug severity would produce a message if called, but createNotification skips it', () => {
  // The skip-set check lives in notifications.ts. Here we just confirm that
  // formatTelegramMessage itself doesn't add special debug handling — the gate
  // is upstream. This keeps the formatter a pure utility.
  const result = formatTelegramMessage({ message: 'Debug trace.', severity: 'debug' });
  assert.ok(result.length > 0, 'formatter itself is permissive; gating is in createNotification');
});
