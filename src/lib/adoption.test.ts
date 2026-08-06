import assert from 'node:assert/strict';
import { test } from 'node:test';
import { adoption, adoptionHeadline, type AdoptionInput } from './adoption';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function ws(over: Partial<AdoptionInput>): AdoptionInput {
  return {
    name: 'W', status: 'active',
    capturedAt: '2026-07-01T00:00:00Z', essentialsFilled: 6, essentialsTotal: 6,
    hasAssistantName: true, hasStartDate: true,
    members: 2, hasAssistantLogin: true, goLiveOn: null,
    lastActivityAt: ago(1),
    ...over,
  };
}

test('a fully set up, busy book of business reads clean', () => {
  const a = adoption([ws({}), ws({})], NOW);
  assert.equal(a.ready, 2);
  assert.equal(a.activeThisWeek, 2);
  assert.deepEqual(a.liveButUnfinished, []);
  assert.match(adoptionHeadline(a), /All 2 are set up/);
});

test('open-but-unfinished is called out by NAME, and leads the headline', () => {
  // The actual production state: live workspaces with nothing captured.
  const a = adoption([
    ws({ name: 'Teresa', capturedAt: null, essentialsFilled: 0 }),
    ws({ name: 'Brian', capturedAt: null, essentialsFilled: 0 }),
    ws({}),
  ], NOW);
  assert.deepEqual(a.liveButUnfinished, ['Teresa', 'Brian']);
  assert.match(adoptionHeadline(a), /2 of 3 are open to a client with setup unfinished/);
});

test('SET UP and USED are counted separately', () => {
  // Perfectly configured and abandoned. Every per-workspace check says it is fine.
  const a = adoption([ws({ lastActivityAt: ago(60) })], NOW);
  assert.equal(a.ready, 1, 'setup is complete');
  assert.equal(a.activeThisWeek, 0, 'and nobody has touched it');
});

test('set up then abandoned is surfaced, since nothing else would show it', () => {
  const a = adoption([ws({ name: 'Quiet Co', lastActivityAt: ago(30) })], NOW);
  assert.deepEqual(a.goneQuiet, ['Quiet Co']);
  assert.match(adoptionHeadline(a), /went quiet/);
});

test('never used is distinct from gone quiet', () => {
  const a = adoption([ws({ lastActivityAt: null })], NOW);
  assert.equal(a.neverUsed, 1);
  assert.deepEqual(a.goneQuiet, [], 'never used is not the same as used and then stopped');
  assert.match(adoptionHeadline(a), /never been used/);
});

test('a workspace not yet open is not "live but unfinished"', () => {
  // Built on the onboarding call and not opened yet is the CORRECT state, not a problem.
  const a = adoption([ws({ status: 'provisioned', capturedAt: null, essentialsFilled: 0, members: 0 })], NOW);
  assert.deepEqual(a.liveButUnfinished, []);
  assert.equal(a.open, 0);
});

test('the headline names the worst true thing, not a percentage', () => {
  const worst = adoption([
    ws({ name: 'A', capturedAt: null, essentialsFilled: 0 }),
    ws({ name: 'B', lastActivityAt: null }),
  ], NOW);
  // Both problems exist; the live-and-unfinished one leads.
  assert.match(adoptionHeadline(worst), /open to a client with setup unfinished/);
});

test('an empty book says so rather than dividing by zero', () => {
  assert.match(adoptionHeadline(adoption([], NOW)), /No workspaces yet/);
});
