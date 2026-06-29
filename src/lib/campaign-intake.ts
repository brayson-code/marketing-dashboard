// Campaign intake — the (zero-agent) front door to a campaign of ANY objective.
// Turns a plain-English request into a structured brief (incl. an objective_type
// classifier) and the deliberately uncomfortable questions the owner should sit
// with (brief: "the hardest part was the intake interview"). The brief's
// verifiable success criterion becomes a /goals entry — so intake BIRTHS the goal
// that later drives the outcome reward and the curriculum flip. The brief then
// feeds campaign-planner.composeWavePlan, which builds the wave recipe: 'research'
// short-circuits to the legacy 4-wave template; any other objective is planned by
// one forced-tool model call. (Design: KB doc "Command Center PARL".)

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { createGoal } from './goals';
import { createCampaign, type CampaignBrief, type StopWhen } from './waves';
import { composeWavePlan, planToWaves, type WavePlan } from './campaign-planner';

/** A brief plus the kind of campaign it is — drives which wave plan is composed.
 *  'research' short-circuits to the legacy 4-wave recipe (no planner call). */
export interface CampaignBriefWithType extends CampaignBrief {
  objective_type: string;
}

export interface DraftedBrief {
  title: string;
  brief: CampaignBriefWithType;
}

export async function draftCampaignBrief(request: string): Promise<DraftedBrief> {
  const text = String(request ?? '').trim();
  if (!text) throw new Error('Describe what you want to research in a sentence or two.');
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(NO_ANTHROPIC_KEY_MESSAGE);

  const client = new Anthropic({ apiKey, maxRetries: 5 });
  const tool: Anthropic.Messages.Tool = {
    name: 'emit_brief',
    description: 'Emit a structured campaign brief derived from the request.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short campaign title' },
        objective_type: {
          type: 'string',
          description:
            "the KIND of campaign in one short slug. Use 'research' for any market/competitor/customer " +
            "research where the deliverable is a report. Otherwise pick a fitting slug like 'content', " +
            "'launch', 'outreach', or 'audit' — this routes which agents run.",
        },
        objective: { type: 'string', description: 'the precise objective in 1-2 sentences' },
        success: { type: 'string', description: 'an OBJECTIVELY VERIFIABLE definition of success (what the finished campaign must answer/produce)' },
        audience: { type: 'string', description: 'who the findings are for and the relevant context (company, market, budget)' },
        constraints: { type: 'string', description: 'any scope limits, must-include angles, or out-of-scope notes' },
        risks: {
          type: 'array',
          items: { type: 'string' },
          description: '2-4 deliberately uncomfortable questions the owner should answer before committing (e.g. strongest argument against this, what a funded competitor would do, what would make this fail).',
        },
      },
      required: ['title', 'objective', 'success'],
    },
  };

  const system =
    'You run a sharp intake for a marketing operator. Convert their request into a tight ' +
    'campaign brief. First classify objective_type — use "research" when they want findings/a report; ' +
    'otherwise a fitting slug (content, launch, outreach, audit, …). The success criterion MUST be ' +
    'objectively verifiable (something you could later check is true), because it becomes a tracked goal. ' +
    'The risks array must contain genuinely uncomfortable, useful questions — not softballs. Always call emit_brief.';

  const res = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'emit_brief' },
    messages: [{ role: 'user', content: text }],
  });

  const use = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_brief',
  );
  if (!use) throw new Error('Could not turn that into a brief — try adding what you want to learn and for what decision.');
  const input = use.input as { title: string; objective_type?: string; objective: string; success: string; audience?: string; constraints?: string; risks?: string[] };
  return {
    title: input.title,
    brief: {
      objective_type: typeof input.objective_type === 'string' && input.objective_type.trim() ? input.objective_type.trim() : 'research',
      objective: input.objective,
      success: input.success,
      audience: input.audience,
      constraints: input.constraints,
      risks: Array.isArray(input.risks) ? input.risks : [],
    },
  };
}

export interface DraftedCampaignGoal { title: string; success: string; due: string | null }

/**
 * Draft ONE verifiable North Star goal for a Campaign container from its name +
 * brief + channels. Cheap Haiku call, tool-forced. Returns null on any failure
 * so campaign creation never blocks on it. The success criterion is forced to be
 * objectively verifiable so the goal can actually drive the reward/observer loop.
 */
export async function draftCampaignGoal(input: {
  name: string;
  brief?: string;
  channels?: string[];
}): Promise<DraftedCampaignGoal | null> {
  const name = String(input.name ?? '').trim();
  if (!name) return null;
  const apiKey = await getAnthropicKey();
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey, maxRetries: 3 });
    const tool: Anthropic.Messages.Tool = {
      name: 'emit_goal',
      description: 'Emit a single measurable North Star goal for this marketing campaign.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'short goal title' },
          success: { type: 'string', description: 'an OBJECTIVELY VERIFIABLE definition of done — a number/threshold you could later check, not a vibe' },
          due: { type: 'string', description: 'ISO date YYYY-MM-DD, or empty if no deadline' },
        },
        required: ['title', 'success'],
      },
    };
    const res = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 400,
      system:
        'You convert a marketing campaign into ONE measurable North Star goal for a marketing operator. ' +
        'The success criterion MUST be objectively verifiable (a specific number/threshold), because it becomes a tracked goal. Always call emit_goal.',
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_goal' },
      messages: [{
        role: 'user',
        content:
          `Campaign: ${name}\n` +
          (input.brief?.trim() ? `Brief: ${input.brief.trim()}\n` : '') +
          (input.channels?.length ? `Channels: ${input.channels.join(', ')}\n` : ''),
      }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_goal',
    );
    if (!use) return null;
    const inp = use.input as { title?: string; success?: string; due?: string };
    if (!inp.title || !inp.success) return null;
    const due = inp.due && /^\d{4}-\d{2}-\d{2}$/.test(inp.due) ? inp.due : null;
    return { title: inp.title, success: inp.success, due };
  } catch (e) {
    console.error('[campaign-goal] draft failed:', (e as Error).message);
    return null;
  }
}

export interface LaunchedCampaign {
  id: string;
  goalId: string;
  title: string;
  brief: CampaignBriefWithType;
  /** The composed plan that built this mission's waves — surfaced so the UI can
   *  show the planned waves (titles + agents) at launch. */
  plan: WavePlan;
}

/** A drafted brief + its composed plan, for a PREVIEW step that doesn't launch. */
export interface CampaignPreview {
  title: string;
  brief: CampaignBriefWithType;
  plan: WavePlan;
}

/**
 * Intake → brief → composed plan, WITHOUT creating a goal or mission. Powers the
 * plan-preview step so the owner can see the planned waves (titles + agents)
 * before committing. 'research' briefs short-circuit to the static plan (no extra
 * model call); every other objective makes one planner call.
 */
export async function previewCampaignPlan(request: string): Promise<CampaignPreview> {
  const { title, brief } = await draftCampaignBrief(request);
  const plan = await composeWavePlan(brief);
  return { title, brief, plan };
}

/**
 * Full intake → goal → mission for ANY objective. Creates the verifiable goal
 * first (the outcome anchor), then composes the wave plan (research short-circuits
 * to the legacy 4-wave recipe; other objectives go through the planner), then the
 * mission linked to the goal. Does NOT run any wave — the caller advances waves.
 *
 * An optional pre-composed `plan` (from previewCampaignPlan) is reused so the
 * preview the owner approved is exactly what launches — no second planner call,
 * no drift. When omitted, the plan is composed here.
 *
 * When `campaignId` is set, the new mission is tagged to that Campaign container
 * so it shows up in the Campaign's rolled-up mission list. When omitted, the
 * mission is standalone (today's default).
 */
export async function launchCampaign(
  request: string,
  opts: { campaignId?: string | null; plan?: WavePlan; maxWaves?: number | null; stopWhen?: StopWhen | null } = {},
): Promise<LaunchedCampaign> {
  const { title, brief } = await draftCampaignBrief(request);
  const plan = opts.plan ?? (await composeWavePlan(brief));
  const goal = await createGoal({
    title,
    success: brief.success,
    owner: 'owner',
    metadata: {
      // Mission goals are orchestrator-owned so they surface on the KeyPlayer
      // hero card + the goal-observer attaches, instead of floating unowned.
      owner_agent: 'keyplayer',
      source: 'mission',
      // Record the objective so the campaign rollup + analytics can group by kind.
      objective_type: brief.objective_type,
      // When launched inside a Campaign container, link the goal so the campaign
      // can roll up the goals of the missions it spawned.
      ...(opts.campaignId ? { campaign_id: opts.campaignId } : {}),
    },
  });
  const waves = planToWaves(plan, brief);
  const id = await createCampaign({
    title, request, brief, waves,
    goalId: goal.id,
    campaignId: opts.campaignId ?? null,
    maxWaves: opts.maxWaves ?? null,
    stopWhen: opts.stopWhen ?? null,
  });
  return { id, goalId: goal.id, title, brief, plan };
}

/**
 * Back-compat wrapper: the original research-only entry point. Delegates to the
 * generalized launchCampaign. Existing callers (and any that force a research
 * mission) keep working unchanged — the brief's objective_type drives the recipe,
 * and a research brief short-circuits to the legacy 4-wave plan.
 */
export async function launchResearchCampaign(
  request: string,
  opts: { campaignId?: string | null; maxWaves?: number | null; stopWhen?: StopWhen | null } = {},
): Promise<LaunchedCampaign> {
  return launchCampaign(request, opts);
}
