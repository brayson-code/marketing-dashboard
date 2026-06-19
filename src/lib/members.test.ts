import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  sanitizeGrants,
  wouldOrphanWorkspace,
  isWorkspaceRole,
  isGrantableCapability,
  revokeUserSessions,
  GRANTABLE_CAPABILITIES,
} from './members';

test('isWorkspaceRole accepts only owner|member|va', () => {
  assert.equal(isWorkspaceRole('owner'), true);
  assert.equal(isWorkspaceRole('member'), true);
  assert.equal(isWorkspaceRole('va'), true);
  assert.equal(isWorkspaceRole('admin'), false);
  assert.equal(isWorkspaceRole('editor'), false);
  assert.equal(isWorkspaceRole(''), false);
  assert.equal(isWorkspaceRole(null), false);
});

test('isGrantableCapability only matches the grantable matrix', () => {
  for (const cap of GRANTABLE_CAPABILITIES) {
    assert.equal(isGrantableCapability(cap.key), true);
  }
  // Owner-only / out-of-matrix capabilities must NOT be grantable.
  assert.equal(isGrantableCapability('manage_system'), false);
  assert.equal(isGrantableCapability('manage_users'), false);
  assert.equal(isGrantableCapability('billing'), false);
  assert.equal(isGrantableCapability('rotate_secret'), false);
  assert.equal(isGrantableCapability(42), false);
});

test('sanitizeGrants keeps only grantable keys and coerces to true', () => {
  const out = sanitizeGrants({
    content_write: true,
    crm_write: 'true',
    approve: 1,
    publish: false, // falsey → dropped
    view_audit: 0, // falsey → dropped
    manage_system: true, // owner-only → dropped (can't smuggle in)
    random: true, // unknown → dropped
  });
  assert.deepEqual(out, { content_write: true, crm_write: true, approve: true });
  // Every surviving value is exactly `true`.
  for (const v of Object.values(out)) assert.equal(v, true);
});

test('sanitizeGrants drops everything for an empty / all-false payload', () => {
  assert.deepEqual(sanitizeGrants({}), {});
  assert.deepEqual(sanitizeGrants({ content_write: false, publish: false }), {});
});

test('sanitizeGrants rejects non-object and nested payloads', () => {
  assert.throws(() => sanitizeGrants(null));
  assert.throws(() => sanitizeGrants('content_write'));
  assert.throws(() => sanitizeGrants([1, 2, 3]));
  assert.throws(() => sanitizeGrants({ content_write: { nested: true } }));
});

test('wouldOrphanWorkspace blocks demoting/removing the last owner only', () => {
  // Demoting the SOLE owner → orphans the workspace.
  assert.equal(wouldOrphanWorkspace('owner', 'member', 1), true);
  assert.equal(wouldOrphanWorkspace('owner', 'va', 1), true);
  // Removing the SOLE owner (nextRole null) → orphans.
  assert.equal(wouldOrphanWorkspace('owner', null, 1), true);
  // With a second owner present, demotion/removal is fine.
  assert.equal(wouldOrphanWorkspace('owner', 'member', 2), false);
  assert.equal(wouldOrphanWorkspace('owner', null, 2), false);
  // Keeping the role owner is always fine.
  assert.equal(wouldOrphanWorkspace('owner', 'owner', 1), false);
  // Non-owner targets never orphan the workspace, regardless of count.
  assert.equal(wouldOrphanWorkspace('member', null, 1), false);
  assert.equal(wouldOrphanWorkspace('va', 'member', 1), false);
  assert.equal(wouldOrphanWorkspace(null, 'member', 1), false);
});

test('revokeUserSessions is a graceful no-op when admin auth is unconfigured', async () => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const ok = await revokeUserSessions('00000000-0000-0000-0000-000000000001');
    assert.equal(ok, false); // returns false, never throws
  } finally {
    if (url !== undefined) process.env.NEXT_PUBLIC_SUPABASE_URL = url;
    if (key !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
  }
});
