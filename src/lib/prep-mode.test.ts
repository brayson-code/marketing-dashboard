import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shouldBlockForPrep, isInPrep, isReadOnlyMethod, isPrepExemptPath } from './prep-mode';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const FUTURE = '2026-08-12T00:00:00Z';
const PAST = '2026-08-01T00:00:00Z';

test('reading is always allowed, including during prep', () => {
  for (const m of ['GET', 'HEAD', 'OPTIONS', 'get']) {
    assert.equal(
      shouldBlockForPrep({ prepUntil: FUTURE, method: m, pathname: '/api/tasks', now: NOW }),
      false, `${m} must pass`,
    );
  }
});

test('writing during prep is blocked', () => {
  for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    assert.equal(
      shouldBlockForPrep({ prepUntil: FUTURE, method: m, pathname: '/api/tasks', now: NOW }),
      true, `${m} must be blocked`,
    );
  }
});

test('once day one passes, writing is allowed again with no other change', () => {
  assert.equal(
    shouldBlockForPrep({ prepUntil: PAST, method: 'POST', pathname: '/api/tasks', now: NOW }),
    false,
  );
});

test('someone not in prep is never blocked', () => {
  for (const v of [null, undefined, '', 'not-a-date', 0, {}]) {
    assert.equal(
      shouldBlockForPrep({ prepUntil: v, method: 'POST', pathname: '/api/tasks', now: NOW }),
      false, `${JSON.stringify(v)} must not block`,
    );
  }
});

test('a malformed claim fails OPEN, not closed', () => {
  // A wrong `false` means an assistant acts a day early. A wrong `true` means a working
  // assistant silently cannot do their job. The second is far worse.
  assert.equal(isInPrep('garbage', NOW), false);
  assert.equal(isInPrep('2026-13-45T99:99:99Z', NOW), false);
});

test('auth paths stay writable, or prep would lock them out of their own account', () => {
  for (const p of ['/api/auth/session', '/api/auth/signout', '/auth/confirm', '/auth/set-password']) {
    assert.equal(isPrepExemptPath(p), true, `${p} must stay writable`);
    assert.equal(
      shouldBlockForPrep({ prepUntil: FUTURE, method: 'POST', pathname: p, now: NOW }),
      false,
    );
  }
});

test('an ordinary path that merely starts similarly is NOT exempt', () => {
  assert.equal(isPrepExemptPath('/api/authors'), false);
  assert.equal(
    shouldBlockForPrep({ prepUntil: FUTURE, method: 'POST', pathname: '/api/authors', now: NOW }),
    true,
  );
});

test('the boundary is the instant prep expires', () => {
  const at = '2026-08-05T12:00:00Z';
  assert.equal(isInPrep(at, Date.parse(at)), false, 'expiry instant is no longer prep');
  assert.equal(isInPrep(at, Date.parse(at) - 1), true);
});

test('method casing and stray values are handled', () => {
  assert.equal(isReadOnlyMethod('get'), true);
  assert.equal(isReadOnlyMethod('Get'), true);
  assert.equal(isReadOnlyMethod(''), false);
  assert.equal(isReadOnlyMethod('POST'), false);
});
