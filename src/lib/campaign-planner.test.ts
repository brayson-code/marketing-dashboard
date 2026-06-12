import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  validateWavePlan,
  composeWavePlanFromObjectiveType,
  RESEARCH_PLAN,
  type WavePlan,
} from './campaign-planner';

// --- Canned GOOD plans -------------------------------------------------------
// Three realistic, distinct objectives. Each must pass the validator unchanged:
// 2-4 waves, every agent id in SUBAGENT_REGISTRY, last wave synthesizes.

const CONTENT_BLITZ: WavePlan = {
  objective_type: 'content',
  waves: [
    {
      title: 'Wave 1: Angle Mining',
      goal: 'Surface the highest-leverage content angles for the launch.',
      agent_ids: ['research-analyst', 'reel-ideator'],
      prompt_directives: 'Mine trends and competitor wins for testable angles.',
    },
    {
      title: 'Wave 2: Drafting',
      goal: 'Produce platform-native drafts for the chosen angles.',
      agent_ids: ['content-writer', 'content-cascade', 'carousel-generator'],
      prompt_directives: 'Draft one piece per platform from the strongest angles.',
    },
    {
      title: 'Wave 3: Synthesis & Calendar',
      goal: 'Synthesize the drafts into a sequenced 2-week content calendar.',
      agent_ids: ['content-writer', 'deliverable-qa'],
      prompt_directives: 'Sequence and QA the drafts into one publish-ready plan.',
    },
  ],
  final_deliverable: 'A sequenced 2-week content calendar with publish-ready drafts.',
};

const PRODUCT_LAUNCH: WavePlan = {
  objective_type: 'launch',
  waves: [
    {
      title: 'Wave 1: Market & Positioning',
      goal: 'Establish the market context and sharpest positioning.',
      agent_ids: ['research-analyst', 'research-analyst'],
      prompt_directives: 'Size the opportunity and define the wedge.',
    },
    {
      title: 'Wave 2: Assets',
      goal: 'Produce the core launch assets.',
      agent_ids: ['content-writer', 'carousel-generator', 'thumbnail-generator'],
      prompt_directives: 'Draft announcement copy, a carousel, and a cover spec.',
    },
    {
      title: 'Wave 3: Distribution',
      goal: 'Plan the channel rollout.',
      agent_ids: ['research-analyst', 'outreach-sender'],
      prompt_directives: 'Rank channels and draft launch-day outreach.',
    },
    {
      title: 'Wave 4: Launch Plan',
      goal: 'Synthesize everything into a single dated launch runbook.',
      agent_ids: ['content-writer', 'deliverable-qa'],
      prompt_directives: 'Compile assets + distribution into one runbook and QA it.',
    },
  ],
  final_deliverable: 'A dated launch runbook with assets and a distribution plan.',
};

const OUTREACH_SEQUENCE: WavePlan = {
  objective_type: 'outreach',
  waves: [
    {
      title: 'Wave 1: Prospect Intel',
      goal: 'Build cited profiles of the target prospects.',
      agent_ids: ['lead-research', 'research-analyst'],
      prompt_directives: 'Profile prospects and surface real, citable signals.',
    },
    {
      title: 'Wave 2: Sequence',
      goal: 'Draft and pressure-test the outreach sequence.',
      agent_ids: ['outreach-sender', 'deliverable-qa'],
      prompt_directives: 'Draft a 3-touch sequence, then QA it against the brief.',
    },
  ],
  final_deliverable: 'A 3-touch outreach sequence with per-prospect personalization notes.',
};

test('validateWavePlan accepts a content-blitz plan', () => {
  const r = validateWavePlan(CONTENT_BLITZ);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
});

test('validateWavePlan accepts a product-launch plan', () => {
  const r = validateWavePlan(PRODUCT_LAUNCH);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
});

test('validateWavePlan accepts an outreach-sequence plan', () => {
  const r = validateWavePlan(OUTREACH_SEQUENCE);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
});

// --- Rejections --------------------------------------------------------------

test('validateWavePlan rejects an unknown agent id', () => {
  const bad: WavePlan = {
    ...CONTENT_BLITZ,
    waves: CONTENT_BLITZ.waves.map((w, i) =>
      i === 0 ? { ...w, agent_ids: ['research-analyst', 'totally-made-up-agent'] } : w,
    ),
  };
  const r = validateWavePlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /totally-made-up-agent/);
});

test('validateWavePlan rejects a 1-wave plan', () => {
  const bad: WavePlan = { ...OUTREACH_SEQUENCE, waves: [OUTREACH_SEQUENCE.waves[0]] };
  const r = validateWavePlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /2-4 waves|at least 2/i);
});

test('validateWavePlan rejects a 5-wave plan', () => {
  const w = PRODUCT_LAUNCH.waves;
  const bad: WavePlan = { ...PRODUCT_LAUNCH, waves: [...w, { ...w[0], title: 'Wave 5: Extra' }] };
  const r = validateWavePlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /2-4 waves|at most 4/i);
});

test('validateWavePlan rejects a wave with too few agents', () => {
  const bad: WavePlan = {
    ...OUTREACH_SEQUENCE,
    waves: OUTREACH_SEQUENCE.waves.map((wv, i) =>
      i === 0 ? { ...wv, agent_ids: ['lead-research'] } : wv,
    ),
  };
  const r = validateWavePlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /2-3 agents|agents/i);
});

test('validateWavePlan rejects a plan whose last wave does not synthesize', () => {
  // Strip synthesis signal from the final wave: no synth/conclude/compile in
  // title, goal, directives, or deliverable.
  const last = OUTREACH_SEQUENCE.waves[OUTREACH_SEQUENCE.waves.length - 1];
  const bad: WavePlan = {
    ...OUTREACH_SEQUENCE,
    waves: [
      OUTREACH_SEQUENCE.waves[0],
      {
        ...last,
        title: 'Wave 2: More Drafts',
        goal: 'Write even more outreach emails.',
        // No synthesis agent (deliverable-qa) and no concluding language.
        agent_ids: ['outreach-sender', 'content-writer'],
        prompt_directives: 'Keep drafting fresh emails.',
      },
    ],
    final_deliverable: 'A pile of outreach emails.',
  };
  const r = validateWavePlan(bad);
  assert.equal(r.ok, false);
  assert.match(r.ok ? '' : r.error, /synthesi|conclude|final/i);
});

// --- Research short-circuit (the regression guarantee) -----------------------

test("composeWavePlanFromObjectiveType('research') returns RESEARCH_PLAN identically", () => {
  const plan = composeWavePlanFromObjectiveType('research');
  assert.deepEqual(plan, RESEARCH_PLAN);
});

test('RESEARCH_PLAN itself validates', () => {
  const r = validateWavePlan(RESEARCH_PLAN);
  assert.equal(r.ok, true, r.ok ? '' : r.error);
});

test('RESEARCH_PLAN reproduces the 4 research waves with research-analyst agents', () => {
  assert.equal(RESEARCH_PLAN.objective_type, 'research');
  assert.equal(RESEARCH_PLAN.waves.length, 4);
  for (const w of RESEARCH_PLAN.waves) {
    for (const a of w.agent_ids) assert.equal(a, 'research-analyst');
  }
});
