import assert from 'node:assert/strict';
import { test } from 'node:test';
import { briefingsQueue, docTitle, type QueueDoc } from './briefings-queue';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const ago = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

function doc(over: Partial<QueueDoc>): QueueDoc {
  return {
    id: 'd1', title: 'Competitor pricing', type: 'note', status: 'raw',
    created_by: 'owner', created_at: ago(1), ...over,
  };
}

test('promoted and archived documents are done and never appear', () => {
  const docs = [doc({ status: 'wiki' }), doc({ status: 'archived' })];
  assert.deepEqual(briefingsQueue(docs, NOW), []);
});

test('an agent-written draft is flagged immediately, however new', () => {
  // Nobody asked for it, so nobody is looking for it. Age is not the trigger here.
  const q = briefingsQueue([doc({ created_by: 'claude', created_at: ago(0) })], NOW);
  assert.equal(q.length, 1);
  assert.equal(q[0].bucket, 'unread');
  assert.match(q[0].reason, /written by claude today, not read yet/);
});

test("an owner's own fresh draft is NOT nagged about", () => {
  // They wrote it, they know it is there.
  assert.deepEqual(briefingsQueue([doc({ created_by: 'owner', created_at: ago(2) })], NOW), []);
});

test("an owner's draft DOES surface once it has gone stale", () => {
  const q = briefingsQueue([doc({ created_by: 'owner', created_at: ago(30) })], NOW);
  assert.equal(q[0].bucket, 'stale');
  assert.match(q[0].reason, /sitting as a draft for 30 days/);
});

test('agent-written sorts above stale, and oldest first within each', () => {
  const q = briefingsQueue([
    doc({ id: 'old-owner', created_by: 'owner', created_at: ago(60) }),
    doc({ id: 'new-agent', created_by: 'claude', created_at: ago(1) }),
    doc({ id: 'old-agent', created_by: 'claude', created_at: ago(20) }),
  ], NOW);
  assert.deepEqual(q.map(i => i.doc.id), ['old-agent', 'new-agent', 'old-owner']);
});

test('a missing creator counts as a person, not an agent', () => {
  // Failing the other way would nag about every legacy row with no created_by.
  assert.deepEqual(briefingsQueue([doc({ created_by: null, created_at: ago(2) })], NOW), []);
  assert.deepEqual(briefingsQueue([doc({ created_by: '', created_at: ago(2) })], NOW), []);
});

test('an unparseable date does not crash or produce a negative age', () => {
  const q = briefingsQueue([doc({ created_by: 'claude', created_at: 'nonsense' })], NOW);
  assert.equal(q.length, 1);
  assert.equal(q[0].days, 0);
});

test('an untitled document still reads as something', () => {
  assert.equal(docTitle(doc({ title: null })), 'Untitled');
  assert.equal(docTitle(doc({ title: '   ' })), 'Untitled');
});
