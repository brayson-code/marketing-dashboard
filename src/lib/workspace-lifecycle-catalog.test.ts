import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextStatus, allowedActions, isOpen, isWorkspaceStatus, STATUS_ORDER,
  type WorkspaceStatus, type LifecycleAction,
} from './workspace-lifecycle-catalog';

// Every transition here decides whether a paying client can get into their workspace,
// so the illegal ones matter more than the legal ones.

test('the happy path: built on the call, opened on day one', () => {
  assert.equal(nextStatus('provisioned', 'activate'), 'active');
});

test('only active means people can sign in', () => {
  assert.equal(isOpen('active'), true);
  for (const s of ['provisioned', 'paused', 'offboarded'] as WorkspaceStatus[]) {
    assert.equal(isOpen(s), false, `${s} must not be open`);
  }
});

test('a provisioned workspace cannot be paused or resumed', () => {
  // Nobody has access yet, so both are meaningless and must be refused rather than
  // quietly moving the state.
  assert.equal(nextStatus('provisioned', 'pause'), null);
  assert.equal(nextStatus('provisioned', 'resume'), null);
});

test('a deal that dies before day one can be closed off', () => {
  assert.equal(nextStatus('provisioned', 'offboard'), 'offboarded');
});

test('pause and resume round-trip', () => {
  assert.equal(nextStatus('active', 'pause'), 'paused');
  assert.equal(nextStatus('paused', 'resume'), 'active');
});

test('an active workspace cannot be activated again', () => {
  // Re-activating would re-issue sign-in links to a live client for no reason.
  assert.equal(nextStatus('active', 'activate'), null);
});

test('offboarded is terminal — no action revives it', () => {
  assert.deepEqual(allowedActions('offboarded'), []);
  for (const a of ['activate', 'pause', 'resume', 'offboard'] as LifecycleAction[]) {
    assert.equal(nextStatus('offboarded', a), null, `${a} must not revive an offboarded workspace`);
  }
});

test('every state can reach offboarded except offboarded itself', () => {
  for (const s of ['provisioned', 'active', 'paused'] as WorkspaceStatus[]) {
    assert.equal(nextStatus(s, 'offboard'), 'offboarded');
  }
});

test('every transition lands on a real state', () => {
  for (const from of STATUS_ORDER) {
    for (const action of allowedActions(from)) {
      const to = nextStatus(from, action);
      assert.ok(to && isWorkspaceStatus(to), `${from} -> ${action} produced ${to}`);
      assert.notEqual(to, from, `${from} -> ${action} is a no-op`);
    }
  }
});

test('unknown values are rejected, so a bad column read cannot pass as a state', () => {
  for (const v of ['ACTIVE', 'deleted', '', null, undefined, 7]) {
    assert.equal(isWorkspaceStatus(v), false);
  }
});
