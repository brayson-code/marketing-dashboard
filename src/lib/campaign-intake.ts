// Campaign intake — the (zero-agent) front door to a research campaign. Turns a
// plain-English request into a structured brief, including the deliberately
// uncomfortable questions the owner should sit with (brief: "the hardest part
// was the intake interview"). The brief's verifiable success criterion becomes a
// /goals entry — so intake BIRTHS the goal that later drives the outcome reward
// and the curriculum flip. (Design: KB doc "Command Center PARL".)

import Anthropic from '@anthropic-ai/sdk';
import { createGoal } from './goals';
import { createCampaign, buildResearchCampaign, type CampaignBrief } from './waves';

export interface DraftedBrief {
  title: string;
  brief: CampaignBrief;
}

export async function draftCampaignBrief(request: string): Promise<DraftedBrief> {
  const text = String(request ?? '').trim();
  if (!text) throw new Error('Describe what you want to research in a sentence or two.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const client = new Anthropic({ maxRetries: 5 });
  const tool: Anthropic.Messages.Tool = {
    name: 'emit_brief',
    description: 'Emit a structured research-campaign brief derived from the request.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short campaign title' },
        objective: { type: 'string', description: 'the precise research objective in 1-2 sentences' },
        success: { type: 'string', description: 'an OBJECTIVELY VERIFIABLE definition of success (what the finished research must answer/produce)' },
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
    'You run a sharp research-intake for a marketing operator. Convert their request into a tight ' +
    'campaign brief. The success criterion MUST be objectively verifiable (something you could later ' +
    'check is true), because it becomes a tracked goal. The risks array must contain genuinely ' +
    'uncomfortable, useful questions — not softballs. Always call emit_brief.';

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
  const input = use.input as { title: string; objective: string; success: string; audience?: string; constraints?: string; risks?: string[] };
  return {
    title: input.title,
    brief: {
      objective: input.objective,
      success: input.success,
      audience: input.audience,
      constraints: input.constraints,
      risks: Array.isArray(input.risks) ? input.risks : [],
    },
  };
}

export interface LaunchedCampaign {
  id: string;
  goalId: string;
  title: string;
  brief: CampaignBrief;
}

/**
 * Full intake → goal → campaign for the default 4-wave research flow.
 * Creates the verifiable goal first (the outcome anchor), then the campaign
 * linked to it. Does NOT run any wave — the caller advances waves explicitly.
 */
export async function launchResearchCampaign(request: string): Promise<LaunchedCampaign> {
  const { title, brief } = await draftCampaignBrief(request);
  const goal = await createGoal({
    title,
    success: brief.success,
    owner: 'owner',
  });
  const waves = buildResearchCampaign(brief);
  const id = await createCampaign({ title, request, brief, waves, goalId: goal.id });
  return { id, goalId: goal.id, title, brief };
}
