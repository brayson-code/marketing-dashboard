import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dailyBrief, briefTitle, type BriefFacts } from './daily-brief';
import type { PersonalItem } from './personal';

const NOW = Date.parse('2026-08-05T12:00:00Z');
const iso = (offsetDays: number) => new Date(NOW + offsetDays * 86_400_000).toISOString();

const EMPTY: BriefFacts = {
  approvals: 0, contacts: [], personal: [], founderName: 'Dana', now: NOW,
};

function personal(): PersonalItem {
  return {
    id: 1, title: "Sarah's birthday", category: 'dates', status: 'open',
    due_at: iso(20), lead_days: 7, priority: 'normal',
  } as unknown as PersonalItem;
}

test('nothing to do renders nothing', () => {
  assert.deepEqual(dailyBrief('va', EMPTY), []);
  assert.deepEqual(dailyBrief('client', EMPTY), []);
});

test('approvals read as an action for the founder and a nudge for the assistant', () => {
  const f = { ...EMPTY, approvals: 3 };
  assert.match(dailyBrief('client', f)[0].text, /need your approval/);
  assert.match(dailyBrief('va', f)[0].text, /waiting on Dana to approve/);
});

test('an unnamed founder does not produce "waiting on null"', () => {
  const f = { ...EMPTY, approvals: 1, founderName: null };
  assert.match(dailyBrief('va', f)[0].text, /waiting on your founder/);
});

test('quiet relationships are the assistant\'s job, not the founder\'s', () => {
  const contacts = [{
    id: 'c1', first_name: 'Ray', last_name: null, company: null, title: null,
    notes: null, last_touch_at: iso(-60), next_action_at: null,
  }];
  const f = { ...EMPTY, contacts };
  assert.ok(dailyBrief('va', f).some(i => i.key === 'quiet'));
  assert.ok(!dailyBrief('client', f).some(i => i.key === 'quiet'),
    'a founder should not be handed a list of things they are already not doing');
});

test('overdue follow-ups reach both, worded for each', () => {
  const contacts = [{
    id: 'c1', first_name: 'Ray', last_name: null, company: null, title: null,
    notes: null, last_touch_at: iso(-10), next_action_at: iso(-3),
  }];
  const f = { ...EMPTY, contacts };
  assert.match(dailyBrief('va', f).find(i => i.key === 'overdue')!.text, /owed a reply/);
  assert.match(dailyBrief('client', f).find(i => i.key === 'overdue')!.text, /overdue/);
});

test('personal items use the ACT-BY date, not the due date', () => {
  // Due in 20 days with 7 days lead: act-by is 13 days out, so it is NOT yet due to
  // start and must stay off the brief.
  const far = { ...EMPTY, personal: [personal()] };
  assert.equal(dailyBrief('va', far).length, 0);

  // Due in 8 days with 7 days lead: act-by is tomorrow.
  const soon = {
    ...EMPTY,
    personal: [{ ...personal(), due_at: iso(8) } as PersonalItem],
  };
  const out = dailyBrief('va', soon);
  assert.equal(out.length, 1);
  assert.match(out[0].text, /start within 1 day/);
});

test('a missed act-by date says how late it is', () => {
  const late = {
    ...EMPTY,
    personal: [{ ...personal(), due_at: iso(4) } as PersonalItem],
  };
  assert.match(dailyBrief('va', late)[0].text, /should have been started 3 days ago/);
});

test('an item with no due date is skipped rather than guessed at', () => {
  const undated = {
    ...EMPTY,
    personal: [{ ...personal(), due_at: null } as unknown as PersonalItem],
  };
  assert.deepEqual(dailyBrief('va', undated), []);
});

test('urgent things sort above the rest', () => {
  const f: BriefFacts = {
    ...EMPTY,
    approvals: 1,
    contacts: [{
      id: 'c1', first_name: 'Ray', last_name: null, company: null, title: null,
      notes: null, last_touch_at: iso(-60), next_action_at: null,
    }],
  };
  const out = dailyBrief('va', f);
  assert.equal(out[0].urgency, 'now');
  assert.equal(out[out.length - 1].urgency, 'soon');
});

test('the title names the founder when we know it', () => {
  assert.equal(briefTitle('va', 'Dana'), 'What Dana needs today');
  assert.equal(briefTitle('va', null), 'What your founder needs today');
  assert.equal(briefTitle('client', 'Dana'), 'What needs you');
});
