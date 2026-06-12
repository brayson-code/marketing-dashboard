// Tests for agent audience gating (Spec 3).
//
// Strategy: all assertions use the pure exports from squad.ts
// (audienceFor, isAudienceAllowed, AUDIENCE, squadRoster) plus a controlled
// tenant context via runWithTenant from ./tenant — no DB, no network.
// spawnSubAgent gate tests rely on the fact that the gate fires BEFORE any
// DB/API call, so they return synchronously-equivalent results.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runWithTenant, DEFAULT_TENANT_ID } from './tenant';
import { audienceFor, isAudienceAllowed, AUDIENCE, squadRoster } from './squad';
import { spawnSubAgent } from './subagent';

// Stable non-HQ tenant id used across all client-tenant tests.
const CLIENT_TENANT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// The six ids that must be gated to hq.
const HQ_AGENT_IDS = [
  'fixer',
  'improver',
  'client-onboarding-doc',
  'scope-of-work',
  'weekly-client-status',
  'sponsor-pitch',
] as const;

// ── audienceFor ─────────────────────────────────────────────────────────────

test('audienceFor returns hq for all six gated agent ids', () => {
  for (const id of HQ_AGENT_IDS) {
    assert.equal(
      audienceFor(id),
      'hq',
      `Expected audienceFor('${id}') === 'hq'`,
    );
  }
});

test('audienceFor defaults to client for an absent / unknown id', () => {
  assert.equal(audienceFor('some-brand-new-agent'), 'client');
  assert.equal(audienceFor(''), 'client');
  assert.equal(audienceFor('keyplayer'), 'client');
  assert.equal(audienceFor('research-analyst'), 'client');
});

// ── isAudienceAllowed — HQ context ──────────────────────────────────────────

test('HQ tenant can access all six hq-only agents', () => {
  runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, () => {
    for (const id of HQ_AGENT_IDS) {
      assert.equal(
        isAudienceAllowed(id),
        true,
        `HQ should be allowed to access '${id}'`,
      );
    }
  });
});

test('HQ tenant can access client-audience agents', () => {
  runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, () => {
    assert.equal(isAudienceAllowed('keyplayer'), true);
    assert.equal(isAudienceAllowed('research-analyst'), true);
    assert.equal(isAudienceAllowed('content-writer'), true);
    assert.equal(isAudienceAllowed('pipeline-review'), true);
  });
});

// ── isAudienceAllowed — client tenant context ────────────────────────────────

test('non-HQ tenant is blocked from all six hq-only agents', () => {
  runWithTenant({ tenantId: CLIENT_TENANT_ID, userId: null }, () => {
    for (const id of HQ_AGENT_IDS) {
      assert.equal(
        isAudienceAllowed(id),
        false,
        `Client tenant should NOT be allowed to access '${id}'`,
      );
    }
  });
});

test('non-HQ tenant can access client-audience agents', () => {
  runWithTenant({ tenantId: CLIENT_TENANT_ID, userId: null }, () => {
    assert.equal(isAudienceAllowed('keyplayer'), true);
    assert.equal(isAudienceAllowed('research-analyst'), true);
    assert.equal(isAudienceAllowed('content-writer'), true);
    assert.equal(isAudienceAllowed('pipeline-review'), true);
    // Absent id defaults to client — also allowed.
    assert.equal(isAudienceAllowed('nonexistent-agent'), true);
  });
});

// ── AUDIENCE map completeness ────────────────────────────────────────────────

test('AUDIENCE map contains exactly the six gated ids and no extras', () => {
  const hqKeys = Object.entries(AUDIENCE)
    .filter(([, v]) => v === 'hq')
    .map(([k]) => k)
    .sort();
  const expected = [...HQ_AGENT_IDS].sort();
  assert.deepEqual(hqKeys, expected);
});

// ── squadRoster filtering ────────────────────────────────────────────────────

test('HQ tenant squadRoster includes all six hq-only agents', () => {
  runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, () => {
    const roster = squadRoster();
    const ids = new Set(roster.map((a) => a.id));
    for (const id of HQ_AGENT_IDS) {
      assert.ok(ids.has(id), `HQ roster should include '${id}'`);
    }
  });
});

test('non-HQ tenant squadRoster excludes all six hq-only agents', () => {
  runWithTenant({ tenantId: CLIENT_TENANT_ID, userId: null }, () => {
    const roster = squadRoster();
    const ids = roster.map((a) => a.id);
    for (const id of HQ_AGENT_IDS) {
      assert.equal(
        ids.includes(id),
        false,
        `Client roster should NOT include '${id}'`,
      );
    }
  });
});

test('non-HQ tenant squadRoster still contains client-audience agents', () => {
  runWithTenant({ tenantId: CLIENT_TENANT_ID, userId: null }, () => {
    const roster = squadRoster();
    const ids = new Set(roster.map((a) => a.id));
    assert.ok(ids.has('keyplayer'), 'keyplayer must be in client roster');
    assert.ok(ids.has('research-analyst'), 'research-analyst must be in client roster');
    assert.ok(ids.has('content-writer'), 'content-writer must be in client roster');
  });
});

// ── spawnSubAgent audience gate ──────────────────────────────────────────────

test('non-HQ tenant spawn of hq agent (fixer) returns the gated error', async () => {
  const result = await runWithTenant(
    { tenantId: CLIENT_TENANT_ID, userId: null },
    () => spawnSubAgent('fixer', 'test task'),
  );
  assert.equal(result.ok, false);
  assert.equal(
    result.error,
    'fixer: this agent is not available in this workspace',
    'Error message must match the tagged gate error exactly',
  );
});

test('non-HQ tenant spawn of hq agent (scope-of-work) returns the gated error', async () => {
  const result = await runWithTenant(
    { tenantId: CLIENT_TENANT_ID, userId: null },
    () => spawnSubAgent('scope-of-work', 'test task'),
  );
  assert.equal(result.ok, false);
  assert.equal(result.error, 'scope-of-work: this agent is not available in this workspace');
});

test('HQ tenant spawn of fixer passes the audience gate (fails later for unrelated reasons)', async () => {
  // In tests there is no DB or Anthropic key. The audience gate PASSES for HQ,
  // so the function proceeds past it and fails on the "Unknown sub-agent type"
  // check (fixer is not in SUBAGENT_REGISTRY) rather than the audience gate.
  const result = await runWithTenant(
    { tenantId: DEFAULT_TENANT_ID, userId: null },
    () => spawnSubAgent('fixer', 'test task'),
  );
  assert.equal(result.ok, false);
  // Must NOT be the audience gate error.
  assert.notEqual(
    result.error,
    'fixer: this agent is not available in this workspace',
    'HQ should not be blocked by the audience gate',
  );
  // Should be the "unknown type" error since fixer isn't in SUBAGENT_REGISTRY.
  assert.ok(
    result.error?.includes('Unknown sub-agent type'),
    `Expected "Unknown sub-agent type" error, got: ${result.error}`,
  );
});

test('HQ tenant spawn of client-audience agent passes the audience gate (isAudienceAllowed check)', () => {
  // research-analyst is client-audience → gate passes for both HQ and client.
  // Verified via isAudienceAllowed so we do not require a live DB/API in tests.
  runWithTenant({ tenantId: DEFAULT_TENANT_ID, userId: null }, () => {
    assert.equal(isAudienceAllowed('research-analyst'), true);
    assert.equal(isAudienceAllowed('content-writer'), true);
    assert.equal(isAudienceAllowed('pipeline-review'), true);
  });
});

test('non-HQ tenant spawn of client-audience agent passes the audience gate (isAudienceAllowed check)', () => {
  // research-analyst is client-audience → allowed for all tenants.
  runWithTenant({ tenantId: CLIENT_TENANT_ID, userId: null }, () => {
    assert.equal(isAudienceAllowed('research-analyst'), true);
    assert.equal(isAudienceAllowed('content-writer'), true);
    assert.equal(isAudienceAllowed('pipeline-review'), true);
  });
});
