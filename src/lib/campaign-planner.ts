// Campaign planner — generalizes the wave engine beyond research. Today's wave
// runner (waves.ts) executes ANY ordered list of waves; the only thing that was
// hard-coded was the recipe (buildResearchCampaign). This module composes that
// recipe for ANY objective: one forced-tool claude-sonnet-4-6 call (same shape
// as draftCampaignBrief) turns a brief into a validated, executable wave plan.
//
// The 'research' objective SHORT-CIRCUITS to a static RESEARCH_PLAN that
// reproduces the legacy 4-wave template verbatim — no model call, so the
// research path is byte-for-byte unchanged (the regression guarantee).
//
// validateWavePlan is a pure, exported, unit-testable function (no API call):
// the model output is hard-validated and a bad plan is retried once, then thrown
// with a tagged error so the caller can surface a clean message. (Design: KB
// doc "Command Center PARL" — campaign-generalize.)

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { SUBAGENT_REGISTRY } from './subagent';
import { isAudienceAllowed } from './squad';
import { buildResearchCampaign, buildCampaignFromPlan, type CampaignBrief, type WaveSpec } from './waves';

const PLAN_MODEL = 'claude-sonnet-4-6'; // matches draftCampaignBrief — intake-tier reasoning

/** A single planned wave: 2-3 agents that run in parallel on one objective. */
export interface PlannedWave {
  title: string;
  goal: string;
  /** 2-3 sub-agent ids; every id MUST exist in SUBAGENT_REGISTRY. */
  agent_ids: string[];
  /** Wave-level operating instructions, prepended to each agent's composed task. */
  prompt_directives: string;
}

/** A full, executable plan: 2-4 waves where the last wave synthesizes/concludes. */
export interface WavePlan {
  objective_type: string;
  waves: PlannedWave[];
  final_deliverable: string;
}

export type ValidationResult = { ok: true } | { ok: false; error: string };

/** Tagged error so the API layer can distinguish a planning failure cleanly. */
export class WavePlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WavePlanError';
  }
}

const MIN_WAVES = 2;
const MAX_WAVES = 4;
const MIN_AGENTS_PER_WAVE = 2;
const MAX_AGENTS_PER_WAVE = 3;

// Words that signal the final wave actually collapses prior work into the
// deliverable (rather than spawning yet more parallel production). The last wave
// must carry one of these in its title/goal/directives or the plan's
// final_deliverable — that is what makes the synthesis-forward pipeline terminate
// in a conclusion rather than an open-ended fan-out.
const SYNTHESIS_SIGNALS = [
  'synthesi', // synthesis / synthesize
  'conclude',
  'conclusion',
  'final',
  'compile',
  'consolidat',
  'summari', // summarize / summary
  'runbook',
  'report',
  'recommend',
  'roll up',
  'roll-up',
  'rollup',
  'wrap up',
  'wrap-up',
  'deliverable',
  'plan into one',
  'into one',
  'decision',
  'pressure-test', // a concluding QA/validation pass over the prior waves
  'pressure test',
  ' qa', // "QA it", "QA pass" — a finalizing review step
  'review',
  'sequence', // the final assembly of touches/steps into one ordered output
  'calendar', // assembling drafts into one scheduled plan
  'package', // bundling the prior waves into one package
];

// A final wave that hands its output to a synthesis/QA agent is, by definition, a
// concluding wave even if its prose doesn't use a signal word.
const SYNTHESIS_AGENTS = new Set(['deliverable-qa', 'memory-compactor']);

/**
 * Some SubAgentSpecs may (in future) carry an `audience` allow-list — e.g. an
 * agent that may only run for a specific tenant audience. Today no spec does, so
 * this is a forward-compatible no-op that simply checks registry membership.
 * When an audience constraint is added to a spec, gate here.
 */
function agentExists(agentId: string): boolean {
  return Object.prototype.hasOwnProperty.call(SUBAGENT_REGISTRY, agentId);
}

function looksLikeSynthesis(plan: WavePlan): boolean {
  const last = plan.waves[plan.waves.length - 1];
  if (last.agent_ids.some((a) => SYNTHESIS_AGENTS.has(a))) return true;
  const hay = [last.title, last.goal, last.prompt_directives, plan.final_deliverable]
    .join(' ')
    .toLowerCase();
  return SYNTHESIS_SIGNALS.some((sig) => hay.includes(sig));
}

/**
 * Hard validator for a wave plan. Pure (no API call) so it's unit-testable and
 * runs on both model output AND the static plans. Returns a discriminated result
 * with a human-readable error rather than throwing, so callers can retry.
 */
export function validateWavePlan(plan: unknown): ValidationResult {
  if (!plan || typeof plan !== 'object') return { ok: false, error: 'Plan is not an object.' };
  const p = plan as Partial<WavePlan>;

  if (typeof p.objective_type !== 'string' || !p.objective_type.trim()) {
    return { ok: false, error: 'Plan is missing objective_type.' };
  }
  if (typeof p.final_deliverable !== 'string' || !p.final_deliverable.trim()) {
    return { ok: false, error: 'Plan is missing final_deliverable.' };
  }
  if (!Array.isArray(p.waves)) return { ok: false, error: 'Plan.waves must be an array.' };

  if (p.waves.length < MIN_WAVES || p.waves.length > MAX_WAVES) {
    return {
      ok: false,
      error: `Plan must have 2-4 waves (got ${p.waves.length}); at least ${MIN_WAVES} and at most ${MAX_WAVES}.`,
    };
  }

  for (let i = 0; i < p.waves.length; i++) {
    const w = p.waves[i] as Partial<PlannedWave> | undefined;
    const where = `Wave ${i + 1}`;
    if (!w || typeof w !== 'object') return { ok: false, error: `${where} is not an object.` };
    if (typeof w.title !== 'string' || !w.title.trim()) {
      return { ok: false, error: `${where} is missing a title.` };
    }
    if (typeof w.goal !== 'string' || !w.goal.trim()) {
      return { ok: false, error: `${where} is missing a goal.` };
    }
    if (typeof w.prompt_directives !== 'string' || !w.prompt_directives.trim()) {
      return { ok: false, error: `${where} is missing prompt_directives.` };
    }
    if (!Array.isArray(w.agent_ids)) {
      return { ok: false, error: `${where} agent_ids must be an array.` };
    }
    if (w.agent_ids.length < MIN_AGENTS_PER_WAVE || w.agent_ids.length > MAX_AGENTS_PER_WAVE) {
      return {
        ok: false,
        error: `${where} must use 2-3 agents (got ${w.agent_ids.length}).`,
      };
    }
    for (const a of w.agent_ids) {
      if (typeof a !== 'string' || !agentExists(a)) {
        return {
          ok: false,
          error: `${where} references unknown agent id "${String(a)}" (not in SUBAGENT_REGISTRY).`,
        };
      }
    }
  }

  if (!looksLikeSynthesis(plan as WavePlan)) {
    return {
      ok: false,
      error: 'The last wave must synthesize/conclude (no synthesis/final/report/recommend signal found).',
    };
  }

  return { ok: true };
}

/**
 * The static research recipe, expressed as a WavePlan. Its `waves` are derived
 * from the LEGACY buildResearchCampaign so the two can never drift: we convert
 * the canonical WaveSpec[] into PlannedWave[] with a sentinel objective brief so
 * the agent tasks are identical to what shipped. objective_type 'research'
 * short-circuits to this — no model call — which is the regression guarantee.
 *
 * NOTE: this is a *constant* (deep-frozen at module load) built once from the
 * legacy template using a neutral objective placeholder; planToWaves re-renders
 * the real objective at launch time via buildResearchCampaign for the research
 * path, so the agent task text always carries the live objective. The constant
 * exists for preview/validation/regression-testing of the SHAPE.
 */
function researchWavesAsPlanned(): PlannedWave[] {
  // Build from the legacy template with a stable placeholder so the SHAPE
  // (labels, agent ids, agent count per wave) tracks buildResearchCampaign.
  const specs = buildResearchCampaign({ objective: '{{OBJECTIVE}}', success: '{{SUCCESS}}' });
  return specs.map((w: WaveSpec) => ({
    title: w.label,
    goal: w.label,
    agent_ids: w.agents.map((a) => a.agentId),
    prompt_directives: w.agents.map((a) => a.task).join('\n'),
  }));
}

// Deep-freeze so the regression constant can never be mutated by a consumer that
// reads it for preview/validation (the launch path re-renders fresh, never from
// this object).
const researchWaves = researchWavesAsPlanned();
researchWaves.forEach((w) => {
  Object.freeze(w.agent_ids);
  Object.freeze(w);
});
Object.freeze(researchWaves);

export const RESEARCH_PLAN: WavePlan = Object.freeze({
  objective_type: 'research',
  waves: researchWaves,
  final_deliverable:
    'A decision-ready research report: executive summary, findings by theme, recommended next moves, and a confidence + gaps note.',
}) as WavePlan;

/**
 * Map a known objective_type to a static plan WITHOUT an API call. 'research'
 * returns RESEARCH_PLAN. Any other type returns null (the caller must compose via
 * the model). Exported so the regression test can assert deep-equality.
 */
export function composeWavePlanFromObjectiveType(objectiveType: string): WavePlan | null {
  if (objectiveType.trim().toLowerCase() === 'research') return RESEARCH_PLAN;
  return null;
}

function planTool(): Anthropic.Messages.Tool {
  // Only offer agents the CURRENT workspace is allowed to spawn (audience gating,
  // squad.ts) so the model never proposes an hq-only agent for a client tenant —
  // which would otherwise be a valid registry id but fail at spawn time.
  const agentList = Object.values(SUBAGENT_REGISTRY)
    .filter((s) => isAudienceAllowed(s.id))
    .map((s) => `- ${s.id}: ${s.description}`)
    .join('\n');
  return {
    name: 'emit_plan',
    description:
      'Emit an executable multi-wave plan for the campaign. Each wave runs 2-3 sub-agents in ' +
      'PARALLEL; the next wave builds on a synthesis of the previous one. Available sub-agents:\n' +
      agentList,
    input_schema: {
      type: 'object',
      properties: {
        objective_type: {
          type: 'string',
          description:
            "one short slug for the kind of campaign, e.g. 'content', 'launch', 'outreach', 'audit'",
        },
        waves: {
          type: 'array',
          minItems: MIN_WAVES,
          maxItems: MAX_WAVES,
          description:
            '2-4 ordered waves. The LAST wave MUST synthesize/conclude the prior waves into the final deliverable (not spawn more open-ended production).',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string', description: 'short wave title, e.g. "Wave 2: Drafting"' },
              goal: { type: 'string', description: 'what this wave must accomplish' },
              agent_ids: {
                type: 'array',
                minItems: MIN_AGENTS_PER_WAVE,
                maxItems: MAX_AGENTS_PER_WAVE,
                items: { type: 'string' },
                description:
                  'exactly 2-3 sub-agent ids from the available list — each MUST be one of the ids above',
              },
              prompt_directives: {
                type: 'string',
                description: 'concrete operating instructions for the agents in this wave',
              },
            },
            required: ['title', 'goal', 'agent_ids', 'prompt_directives'],
          },
        },
        final_deliverable: {
          type: 'string',
          description: 'the single concrete artifact the campaign produces at the end',
        },
      },
      required: ['objective_type', 'waves', 'final_deliverable'],
    },
  };
}

function planSystem(): string {
  return (
    'You are the campaign planner for a marketing operator. Turn the brief into an EXECUTABLE ' +
    'multi-wave plan. Rules: 2-4 waves; each wave runs 2-3 sub-agents IN PARALLEL on different ' +
    'angles; the next wave only ever sees a SYNTHESIS of the previous one, so order waves so each ' +
    'builds on the last; every agent_id MUST be one of the available sub-agents (use their real ' +
    'capabilities — research agents research, content agents draft, outreach agents draft outreach); ' +
    'the FINAL wave must SYNTHESIZE/conclude the prior waves into the final_deliverable, not spawn ' +
    'more open-ended work. Always call emit_plan.'
  );
}

function briefToUserPrompt(brief: CampaignBrief): string {
  const parts = [`# Objective\n${brief.objective}`, `# Definition of success\n${brief.success}`];
  if (brief.audience) parts.push(`# Audience / context\n${brief.audience}`);
  if (brief.constraints) parts.push(`# Constraints\n${brief.constraints}`);
  return parts.join('\n\n');
}

async function callPlanner(brief: CampaignBrief, client: Anthropic): Promise<unknown> {
  const res = await client.messages.create({
    model: PLAN_MODEL,
    max_tokens: 2048,
    system: planSystem(),
    tools: [planTool()],
    tool_choice: { type: 'tool', name: 'emit_plan' },
    messages: [{ role: 'user', content: briefToUserPrompt(brief) }],
  });
  const use = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_plan',
  );
  if (!use) throw new WavePlanError('Planner did not emit a plan.');
  return use.input;
}

/**
 * Tenant-aware audience gate over a (already structurally-valid) plan. Separate
 * from validateWavePlan so the validator can stay pure/unit-testable: this reads
 * tenant context via isAudienceAllowed and is only run on the live API path.
 */
function audienceGate(plan: WavePlan): ValidationResult {
  for (let i = 0; i < plan.waves.length; i++) {
    for (const a of plan.waves[i].agent_ids) {
      if (!isAudienceAllowed(a)) {
        return {
          ok: false,
          error: `Wave ${i + 1} uses agent "${a}", which is not available in this workspace.`,
        };
      }
    }
  }
  return { ok: true };
}

/**
 * Compose a validated wave plan for a brief.
 *
 * - objective_type 'research' (set on the brief) SHORT-CIRCUITS to RESEARCH_PLAN
 *   with NO model call — the regression guarantee.
 * - Otherwise: one forced-tool claude-sonnet-4-6 call, hard-validated. On invalid
 *   output, retry ONCE (the validator error is fed back as a correction), then
 *   throw a tagged WavePlanError.
 */
export async function composeWavePlan(
  brief: CampaignBrief & { objective_type?: string },
): Promise<WavePlan> {
  const declared = (brief.objective_type ?? '').trim().toLowerCase();
  // Research short-circuits to the static plan — no API call, no drift.
  if (declared === 'research') return RESEARCH_PLAN;

  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new WavePlanError(NO_ANTHROPIC_KEY_MESSAGE);
  const client = new Anthropic({ apiKey, maxRetries: 5 });

  let lastError = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    let raw: unknown;
    try {
      raw = await callPlanner(brief, client);
    } catch (err) {
      lastError = (err as Error).message;
      continue;
    }
    const candidate = raw as WavePlan;
    const check = validateWavePlan(candidate);
    if (check.ok) {
      // Runtime audience gate (tenant-aware) — kept OUT of the pure validator so
      // validateWavePlan stays unit-testable without tenant context. Rejects a
      // plan that names an agent this workspace can't spawn; the retry is informed.
      const gated = audienceGate(candidate);
      if (gated.ok) {
        // Default objective_type to the declared one when the model left it generic.
        if (declared && (!candidate.objective_type || !candidate.objective_type.trim())) {
          candidate.objective_type = declared;
        }
        return candidate;
      }
      lastError = gated.error;
      brief = {
        ...brief,
        constraints: `${brief.constraints ? brief.constraints + '\n\n' : ''}Your previous plan was invalid: ${gated.error} Fix it and re-emit a valid plan.`,
      };
      continue;
    }
    lastError = check.error;
    // Feed the failure back so the single retry is informed.
    brief = {
      ...brief,
      constraints: `${brief.constraints ? brief.constraints + '\n\n' : ''}Your previous plan was invalid: ${check.error} Fix it and re-emit a valid plan.`,
    };
  }
  throw new WavePlanError(`Could not compose a valid wave plan: ${lastError}`);
}

/**
 * Render an executable WaveSpec[] (what waves.ts runs) from a plan + the live
 * brief. Thin pass-through to the canonical builder in waves.ts (single source of
 * truth) so the research objective re-renders through buildResearchCampaign with
 * the REAL objective text and composed plans map per-agent.
 */
export function planToWaves(plan: WavePlan, brief: CampaignBrief): WaveSpec[] {
  return buildCampaignFromPlan(plan, brief);
}
