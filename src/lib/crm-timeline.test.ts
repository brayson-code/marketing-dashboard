import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mergeTimeline } from './crm-timeline';
import type { SequenceRow, ActivityRow, InboundEmailRow } from './crm-timeline';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const T0 = '2026-01-01T00:00:00.000Z'; // oldest (discovery)
const T1 = '2026-02-01T00:00:00.000Z'; // outreach sent
const T2 = '2026-03-01T00:00:00.000Z'; // inbound email reply
const T3 = '2026-04-01T00:00:00.000Z'; // activity log / newest

const seqSent: SequenceRow = {
  id: 'seq-1',
  step: 1,
  subject: 'Hello there',
  status: 'sent',
  sent_at: T1,
  created_at: '2026-01-15T00:00:00.000Z',
};

const seqPending: SequenceRow = {
  id: 'seq-2',
  step: 2,
  subject: 'Follow up',
  status: 'pending_approval',
  sent_at: null,
  created_at: '2026-01-20T00:00:00.000Z',
};

const seqApproved: SequenceRow = {
  id: 'seq-3',
  step: 3,
  subject: 'Check in',
  status: 'approved',
  sent_at: null,
  created_at: '2026-01-22T00:00:00.000Z',
};

const seqQueued: SequenceRow = {
  id: 'seq-4',
  step: 4,
  subject: 'Final nudge',
  status: 'queued',
  sent_at: null,
  created_at: '2026-01-23T00:00:00.000Z',
};

const seqCancelled: SequenceRow = {
  id: 'seq-5',
  step: 5,
  subject: 'Cancelled step',
  status: 'cancelled',
  sent_at: null,
  created_at: '2026-01-24T00:00:00.000Z',
};

const inbound: InboundEmailRow = {
  received_at: T2,
  from_addr: 'lead@example.com',
  subject: 'Re: Hello there',
  body_text: 'Sounds interesting!',
};

const activity: ActivityRow = {
  ts: T3,
  detail: 'lead:abc123 status: contacted -> replied',
};

// ─── Tests: ordering ──────────────────────────────────────────────────────────

test('mergeTimeline returns newest-first order', () => {
  const result = mergeTimeline([seqSent], [activity], [inbound], T0, 'LinkedIn');
  const ats = result.map(r => r.at);
  for (let i = 0; i < ats.length - 1; i++) {
    assert.ok(
      new Date(ats[i]).getTime() >= new Date(ats[i + 1]).getTime(),
      `item ${i} (${ats[i]}) should be >= item ${i + 1} (${ats[i + 1]})`,
    );
  }
});

test('discovery entry is last (oldest)', () => {
  const result = mergeTimeline([seqSent], [activity], [inbound], T0, 'LinkedIn');
  assert.equal(result[result.length - 1].kind, 'discovery');
  assert.equal(result[result.length - 1].at, T0);
});

test('inbound email entry appears and is newer than outreach_sent', () => {
  const result = mergeTimeline([seqSent], [], [inbound], T0, null);
  const inboundIdx = result.findIndex(r => r.kind === 'inbound_email');
  const sentIdx = result.findIndex(r => r.kind === 'outreach_sent');
  assert.ok(inboundIdx !== -1, 'inbound_email item must exist');
  assert.ok(sentIdx !== -1, 'outreach_sent item must exist');
  // inbound (T2) is newer than sent (T1) → comes first (lower index)
  assert.ok(inboundIdx < sentIdx);
});

// ─── Tests: kinds ─────────────────────────────────────────────────────────────

test('sent sequence produces outreach_sent kind', () => {
  const result = mergeTimeline([seqSent], [], [], null, null);
  assert.ok(result.some(r => r.kind === 'outreach_sent'));
});

test('pending sequence produces outreach_pending kind', () => {
  const result = mergeTimeline([seqPending], [], [], null, null);
  assert.ok(result.some(r => r.kind === 'outreach_pending'));
});

test('approved sequence produces outreach_approved kind', () => {
  const result = mergeTimeline([seqApproved], [], [], null, null);
  assert.ok(result.some(r => r.kind === 'outreach_approved'));
});

test('queued sequence produces outreach_queued kind', () => {
  const result = mergeTimeline([seqQueued], [], [], null, null);
  assert.ok(result.some(r => r.kind === 'outreach_queued'));
});

test('cancelled sequence produces outreach_cancelled kind', () => {
  const result = mergeTimeline([seqCancelled], [], [], null, null);
  assert.ok(result.some(r => r.kind === 'outreach_cancelled'));
});

test('inbound email produces inbound_email kind', () => {
  const result = mergeTimeline([], [], [inbound], null, null);
  assert.ok(result.some(r => r.kind === 'inbound_email'));
});

test('activity log with "status:" text produces status_change kind', () => {
  const result = mergeTimeline([], [activity], [], null, null);
  assert.ok(result.some(r => r.kind === 'status_change'));
});

test('activity log without "status:" text produces note kind', () => {
  const noteRow: ActivityRow = { ts: T3, detail: 'lead:abc123 notes updated' };
  const result = mergeTimeline([], [noteRow], [], null, null);
  assert.ok(result.some(r => r.kind === 'note'));
});

test('discovery with source uses source in detail', () => {
  const result = mergeTimeline([], [], [], T0, 'LinkedIn');
  const disc = result.find(r => r.kind === 'discovery');
  assert.ok(disc);
  assert.ok(disc.detail.includes('LinkedIn'));
});

test('discovery with null source shows "source unknown"', () => {
  const result = mergeTimeline([], [], [], T0, null);
  const disc = result.find(r => r.kind === 'discovery');
  assert.ok(disc);
  assert.ok(disc.detail.includes('unknown'));
});

// ─── Tests: IDs ───────────────────────────────────────────────────────────────

test('ids are 1-based and contiguous', () => {
  const result = mergeTimeline([seqSent], [activity], [inbound], T0, 'LinkedIn');
  for (let i = 0; i < result.length; i++) {
    assert.equal(result[i].id, i + 1);
  }
});

// ─── Tests: edge cases ────────────────────────────────────────────────────────

test('empty inputs returns empty array', () => {
  const result = mergeTimeline([], [], [], null, null);
  assert.deepEqual(result, []);
});

test('sent sequence does not also emit status row for same seq', () => {
  // seq with sent_at set should only emit outreach_sent, not pending/approved etc.
  const sentWithApprovedStatus: SequenceRow = {
    id: 'x',
    step: 1,
    subject: 'Test',
    status: 'approved', // even though status is approved, sent_at is set
    sent_at: T1,
    created_at: T0,
  };
  const result = mergeTimeline([sentWithApprovedStatus], [], [], null, null);
  const kinds = result.map(r => r.kind);
  assert.ok(kinds.includes('outreach_sent'), 'should include outreach_sent');
  assert.ok(!kinds.includes('outreach_approved'), 'should NOT include outreach_approved when sent_at is set');
});

test('multiple inbound emails all appear', () => {
  const emails: InboundEmailRow[] = [
    { received_at: T2, from_addr: 'a@b.com', subject: 'First', body_text: 'hi' },
    { received_at: T3, from_addr: 'a@b.com', subject: 'Second', body_text: 'hey' },
  ];
  const result = mergeTimeline([], [], emails, null, null);
  const inbounds = result.filter(r => r.kind === 'inbound_email');
  assert.equal(inbounds.length, 2);
});

test('no lead.email means no inbound_email items (caller passes empty array)', () => {
  // Simulates the route logic: no email → caller passes []
  const result = mergeTimeline([seqSent], [], [], T0, null);
  assert.ok(!result.some(r => r.kind === 'inbound_email'));
});

test('inbound email with no body_text uses only subject in detail', () => {
  const msg: InboundEmailRow = {
    received_at: T2,
    from_addr: 'a@b.com',
    subject: 'My reply',
    body_text: null,
  };
  const result = mergeTimeline([], [], [msg], null, null);
  const item = result.find(r => r.kind === 'inbound_email');
  assert.ok(item);
  assert.ok(item.detail.includes('My reply'));
});

test('inbound email body preview is capped at 120 chars', () => {
  const longBody = 'x'.repeat(300);
  const msg: InboundEmailRow = {
    received_at: T2,
    from_addr: 'a@b.com',
    subject: null,
    body_text: longBody,
  };
  const result = mergeTimeline([], [], [msg], null, null);
  const item = result.find(r => r.kind === 'inbound_email');
  assert.ok(item);
  assert.ok(item.detail.length <= 150); // subject + ' — ' + 120 chars max
});
