import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstRunCard } from './first-run';
import { FOUNDER_FIELDS, type FounderAnswers } from './founder-profile-catalog';

// A filled-in profile, built from the catalog so it can't drift if the essentials change.
const COMPLETE: FounderAnswers = Object.fromEntries(
  FOUNDER_FIELDS.filter(f => f.essential).map(f => [f.key, 'answered']),
) as FounderAnswers;

test('nobody is nagged once the essentials are answered', () => {
  assert.equal(firstRunCard({ viewer: 'va', answers: COMPLETE, captured: false }), null);
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false }), null);
});

test('the client and the assistant are sent to different places', () => {
  const owner = firstRunCard({ viewer: 'owner', answers: {}, captured: false })!;
  const va = firstRunCard({ viewer: 'va', answers: {}, captured: false })!;
  assert.equal(owner.ctaHref, '/business-setup');
  assert.equal(va.ctaHref, '/founder');
  assert.notEqual(owner.title, va.title);
});

test('the assistant is given questions to ask, not field names', () => {
  const va = firstRunCard({ viewer: 'va', answers: {}, captured: false })!;
  // Real questions end in a question mark; column labels do not.
  assert.ok(va.items.some(i => i.includes('?')), `expected questions, got ${JSON.stringify(va.items)}`);
});

test('the assistant is addressed by the founder name when we know it', () => {
  const named = firstRunCard({ viewer: 'va', answers: {}, captured: false, founderName: 'Dana' })!;
  assert.ok(named.title.includes('Dana'));
  const unnamed = firstRunCard({ viewer: 'va', answers: {}, captured: false })!;
  assert.ok(!unnamed.title.includes('undefined'));
  assert.ok(unnamed.title.includes('your founder'));
});

test('a captured profile changes the ask from author to confirm', () => {
  const cold = firstRunCard({ viewer: 'owner', answers: {}, captured: false })!;
  const captured = firstRunCard({ viewer: 'owner', answers: {}, captured: true })!;
  assert.equal(cold.tone, 'prompt');
  assert.equal(captured.tone, 'confirm');
  assert.notEqual(cold.title, captured.title);
});

test('a COMPLETE captured profile still asks the client to check it once', () => {
  // Someone else wrote their approval limits down. That deserves one look even though
  // nothing is technically missing.
  const card = firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: true })!;
  assert.equal(card.tone, 'confirm');
  assert.deepEqual(card.items, [], 'nothing is missing, so nothing should be listed');
  assert.equal(card.ctaHref, '/business-setup');
});

test('a complete but NOT captured profile shows nothing at all', () => {
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: true })!.tone, 'confirm');
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false }), null);
});

test('only genuinely blank essentials are listed', () => {
  const partial = { ...COMPLETE } as Record<string, string>;
  const first = FOUNDER_FIELDS.find(f => f.essential)!;
  partial[first.key] = '   '; // whitespace is not an answer
  const card = firstRunCard({ viewer: 'owner', answers: partial as FounderAnswers, captured: false })!;
  assert.equal(card.items.length, 1);
  assert.equal(card.items[0], first.label);
});

test('a member sees the client view rather than falling through to nothing', () => {
  const card = firstRunCard({ viewer: 'member', answers: {}, captured: false });
  assert.ok(card, 'a member on an unset workspace should still be prompted');
  assert.equal(card!.ctaHref, '/business-setup');
});

// ── Decay ───────────────────────────────────────────────────────────────────

const NOW = Date.parse('2026-08-05T12:00:00Z');
const agoDays = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

test('a recently-updated complete profile is still silent', () => {
  assert.equal(
    firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false, updatedAt: agoDays(10), now: NOW }),
    null,
  );
});

test('a complete profile untouched for 90 days asks to be re-checked', () => {
  const card = firstRunCard({
    viewer: 'owner', answers: COMPLETE, captured: false, updatedAt: agoDays(120), now: NOW,
  })!;
  assert.equal(card.tone, 'refresh');
  assert.match(card.body, /approval limits/, 'names the thing that matters most if it drifted');
});

test('the decay nudge needs BOTH a date and a clock, or it stays quiet', () => {
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false, updatedAt: agoDays(200) }), null);
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false, now: NOW }), null);
  assert.equal(firstRunCard({ viewer: 'owner', answers: COMPLETE, captured: false, updatedAt: 'nonsense', now: NOW }), null);
});

test('an INCOMPLETE profile is never shown the decay nudge', () => {
  // Missing essentials is the more urgent message; two nags is one too many.
  const card = firstRunCard({ viewer: 'owner', answers: {}, captured: false, updatedAt: agoDays(400), now: NOW })!;
  assert.equal(card.tone, 'prompt');
});
