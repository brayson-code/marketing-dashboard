import assert from 'node:assert/strict';
import { test } from 'node:test';
import { departmentFor, isDepartment } from './agent-department';

test('categories the production data agrees on are mapped', () => {
  assert.equal(departmentFor({ category: 'content' }), 'marketing');
  assert.equal(departmentFor({ category: 'outreach' }), 'revenue');
  assert.equal(departmentFor({ category: 'scheduling' }), 'operations');
  assert.equal(departmentFor({ category: 'knowledge' }), 'operations');
  assert.equal(departmentFor({ category: 'orchestration' }), 'leadership');
});

test('ambiguous categories return null rather than guessing', () => {
  // Real agents in these categories disagree, so a confident answer would be wrong
  // roughly half the time — and wrong on a client-facing org chart.
  assert.equal(departmentFor({ category: 'research' }), null);
  assert.equal(departmentFor({ category: 'general' }), null);
});

test('the C-suite is never inferred from its category', () => {
  // Each exec OWNS a different department; mapping the category would put all five in
  // the same box.
  assert.equal(departmentFor({ category: 'leadership' }), null);
});

test('an id-level exception beats an ambiguous category', () => {
  assert.equal(departmentFor({ id: 'reel-analyst', category: 'research' }), 'marketing');
});

test('unknown input is null, never a default department', () => {
  for (const v of [{}, { category: '' }, { category: 'nonsense' }, { id: null, category: null }]) {
    assert.equal(departmentFor(v), null);
  }
});

test('casing and stray whitespace do not defeat the mapping', () => {
  assert.equal(departmentFor({ category: ' Content ' }), 'marketing');
  assert.equal(departmentFor({ id: 'REEL-ANALYST', category: 'research' }), 'marketing');
});

test('isDepartment rejects anything not on the list', () => {
  assert.equal(isDepartment('marketing'), true);
  for (const v of ['Marketing', 'sales', '', null, 7]) assert.equal(isDepartment(v), false);
});
