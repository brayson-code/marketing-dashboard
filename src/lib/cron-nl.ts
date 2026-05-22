// Turn a plain-English description into a cron job JSON object, so non-technical
// owners can create scheduled jobs without hand-writing cron expressions or
// picking sub-agent ids. We force a single tool call (emit_cron_job) on a cheap
// model and return its structured input. The result is loaded into the editor
// for the owner to review before saving — it is never auto-created.

import Anthropic from '@anthropic-ai/sdk';
import { SUBAGENT_REGISTRY } from './subagent';

const KNOWN_AGENTS = Object.keys(SUBAGENT_REGISTRY);
const DEFAULT_TZ = 'America/New_York';

function agentMenu(): string {
  return Object.values(SUBAGENT_REGISTRY)
    .map((a) => `- ${a.id}: ${a.description}`)
    .join('\n');
}

export interface DraftedJob {
  id?: string;
  name?: string;
  agentId?: string;
  schedule?: { expr?: string; tz?: string };
  payload?: { message?: string; saveToKb?: boolean; kbDoc?: string };
  skill?: string;
}

export async function draftCronJob(prompt: string): Promise<DraftedJob> {
  const text = String(prompt ?? '').trim();
  if (!text) throw new Error('Describe the job you want in a sentence or two.');
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not configured');

  const today = new Date().toISOString().slice(0, 10);
  const client = new Anthropic({ maxRetries: 5 });

  const system =
    'You convert a marketing operator\'s plain-English request into ONE scheduled ' +
    'cron job for the KeyPlayers Command Center. Always call the emit_cron_job tool.\n\n' +
    `Today is ${today}.\n\n` +
    'Pick the single best agentId for the intent:\n' +
    agentMenu() +
    '\n\nRules:\n' +
    '- schedule.expr is a standard 5-field cron ("minute hour day-of-month month day-of-week"). ' +
    'Day-of-week: 0=Sun..6=Sat; weekdays = 1-5.\n' +
    `- schedule.tz is an IANA timezone. Use the one the user names; if none, use ${DEFAULT_TZ}.\n` +
    '- Examples: "every weekday at 9am" -> "0 9 * * 1-5"; "every Monday 7am" -> "0 7 * * 1"; ' +
    '"daily at 6pm" -> "0 18 * * *"; "every hour" -> "0 * * * *"; "1st of each month" -> "0 9 1 * *".\n' +
    '- payload.message: a clear, self-contained instruction the agent can act on with no extra context. ' +
    'Expand the user\'s shorthand into specifics (what to look for, desired output shape, e.g. "5 bullets with sources").\n' +
    '- id: a short kebab-case slug derived from the purpose (e.g. "daily-meta-ads-scan").\n' +
    '- name: a short human title.\n' +
    '- payload.saveToKb: true when the output is reference material the team should keep ' +
    '(research, competitor intel, content ideas). payload.kbDoc: the document name to file it under.\n' +
    '- Never invent an agentId outside the list.';

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_cron_job',
    description: 'Emit exactly one cron job definition derived from the user request.',
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'short kebab-case slug' },
        name: { type: 'string', description: 'short human-friendly title' },
        agentId: { type: 'string', enum: KNOWN_AGENTS, description: 'the sub-agent that runs this job' },
        schedule: {
          type: 'object',
          properties: {
            expr: { type: 'string', description: '5-field cron expression' },
            tz: { type: 'string', description: 'IANA timezone' },
          },
          required: ['expr'],
        },
        payload: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'the full task instruction for the agent' },
            saveToKb: { type: 'boolean', description: 'file the output into the knowledge base' },
            kbDoc: { type: 'string', description: 'knowledge-base document name to file output under' },
          },
          required: ['message'],
        },
        skill: { type: 'string', description: 'short tag, e.g. research / content / outreach' },
      },
      required: ['id', 'name', 'agentId', 'schedule', 'payload'],
    },
  };

  const res = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system,
    tools: [tool],
    tool_choice: { type: 'tool', name: 'emit_cron_job' },
    messages: [{ role: 'user', content: text }],
  });

  const toolUse = res.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_cron_job',
  );
  if (!toolUse) throw new Error('Could not turn that into a job — try rephrasing with a time and what to do.');
  return toolUse.input as DraftedJob;
}
