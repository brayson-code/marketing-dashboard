// Continuous-improvement loop ("auto-research"). Runs on a schedule (Vercel
// Cron) and lets KeyPlayer step back and ask: given everything happening, what
// are the highest-leverage improvements right now? It researches with web_search
// and files concrete proposals as drafts for the owner to review — turning the
// ecosystem from reactive into self-improving.

import Anthropic from '@anthropic-ai/sdk';
import { sql, DEFAULT_TENANT_ID } from './db/client';
import { startTask, finishTask } from './agent-tasks';
import { listActiveGoals } from './goals';
import { listIssues } from './observability';
import { createDraft } from './drafts';
import { createNotification } from './notifications';
import { sendIMessage, isLoopMessageConfigured } from './loopmessage';
import { sendSlack, isSlackConfigured } from './alerts';

const MODEL = 'claude-sonnet-4-6';

const SYSTEM = `You are KeyPlayers' continuous-improvement strategist for a marketing agency's autonomous command center. On a schedule, you review the current state of the business + agent system and identify the highest-leverage improvements.

Your job each run:
1. Read the provided state snapshot (active goals, open issues/bugs, recent agent activity).
2. Use web_search when current external information would sharpen a recommendation (trends, competitor moves, new tactics, tooling).
3. Pick the 1–3 highest-leverage, concrete, actionable improvements. Bias toward things that move revenue, reduce risk, or compound over time.
4. For EACH, call save_proposal with a crisp title and a payload that states: the opportunity, why now, the specific recommended action, and how we'd measure success.

Rules:
- Quality over quantity — at most 3 proposals, ideally the 1–2 that matter most.
- Be specific and grounded in the snapshot; no generic advice.
- Don't repeat proposals that already exist as recent drafts (you'll see them in the snapshot).
- End your turn with a 2–3 sentence summary of what you proposed.`;

function tools(): Anthropic.Messages.ToolUnion[] {
  return [
    { type: 'web_search_20250305', name: 'web_search' },
    {
      name: 'save_proposal',
      description: 'File an improvement proposal as a draft for the owner to review. Call once per distinct improvement.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short, scannable title of the improvement.' },
          payload: { type: 'string', description: 'Opportunity, why now, recommended action, and success metric.' },
        },
        required: ['title', 'payload'],
      },
    },
  ];
}

async function buildSnapshot(): Promise<string> {
  const [goals, openIssues, recentDrafts, recentTasks] = await Promise.all([
    listActiveGoals().catch(() => []),
    listIssues({ limit: 20 }).catch(() => []),
    sql()`SELECT type, title, created_at FROM drafts WHERE tenant_id = ${DEFAULT_TENANT_ID} ORDER BY created_at DESC LIMIT 15`.catch(() => []) as Promise<Array<{ type: string; title: string }>>,
    sql()`SELECT agent_id, status, task FROM agent_tasks WHERE tenant_id = ${DEFAULT_TENANT_ID} ORDER BY started_at DESC LIMIT 20`.catch(() => []) as Promise<Array<{ agent_id: string; status: string; task: string }>>,
  ]);

  const lines: string[] = [];
  lines.push('# State snapshot');
  lines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);

  lines.push(`\n## Active goals (${goals.length})`);
  for (const g of goals.slice(0, 10)) lines.push(`- ${(g as { title?: string }).title ?? JSON.stringify(g)}`);
  if (goals.length === 0) lines.push('- (none)');

  const unresolved = (openIssues as Array<{ status: string; title: string; level: string; count: number }>).filter((i) => i.status !== 'resolved' && i.status !== 'ignored');
  lines.push(`\n## Open issues / bugs (${unresolved.length})`);
  for (const i of unresolved.slice(0, 10)) lines.push(`- [${i.level}] ${i.title} (seen ${i.count}×)`);
  if (unresolved.length === 0) lines.push('- (none — system healthy)');

  lines.push(`\n## Recent drafts already proposed (avoid duplicating)`);
  for (const d of recentDrafts.slice(0, 10)) lines.push(`- [${d.type}] ${d.title}`);
  if (recentDrafts.length === 0) lines.push('- (none)');

  lines.push(`\n## Recent agent activity`);
  for (const t of recentTasks.slice(0, 12)) lines.push(`- ${t.agent_id} [${t.status}]: ${(t.task ?? '').slice(0, 100)}`);
  if (recentTasks.length === 0) lines.push('- (none)');

  return lines.join('\n');
}

export interface ImproveResult {
  ok: boolean;
  proposals: number;
  summary?: string;
  error?: string;
}

export async function runImprovementSweep(): Promise<ImproveResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, proposals: 0, error: 'ANTHROPIC_API_KEY not configured' };

  const taskId = await startTask('improver', 'Continuous-improvement sweep');
  const snapshot = await buildSnapshot();
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: snapshot }];
  let proposals = 0;
  let totalInput = 0;
  let totalOutput = 0;

  try {
    let response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: tools(),
      messages,
    });
    totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens;

    let safety = 0;
    while (safety++ < 8) {
      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens' || response.stop_reason === 'refusal') break;
      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        response = await client.messages.create({ model: MODEL, max_tokens: 4096, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], tools: tools(), messages });
        totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens;
        continue;
      }
      if (response.stop_reason === 'tool_use') {
        const proposalUses = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'save_proposal');
        if (proposalUses.length === 0) break; // web_search runs server-side; only save_proposal is client-handled
        messages.push({ role: 'assistant', content: response.content });
        const results: Anthropic.ToolResultBlockParam[] = [];
        for (const tu of proposalUses) {
          const input = tu.input as { title?: string; payload?: string };
          if (!input.title || !input.payload) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: 'Error: title and payload required.', is_error: true });
            continue;
          }
          try {
            const d = await createDraft({ type: 'other', title: `💡 ${input.title}`.slice(0, 120), payload: input.payload, createdBy: 'improver' });
            proposals++;
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Saved proposal as draft #${d.id}.` });
          } catch (err) {
            results.push({ type: 'tool_result', tool_use_id: tu.id, content: `Error: ${(err as Error).message}`, is_error: true });
          }
        }
        messages.push({ role: 'user', content: results });
        response = await client.messages.create({ model: MODEL, max_tokens: 4096, system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }], tools: tools(), messages });
        totalInput += response.usage.input_tokens; totalOutput += response.usage.output_tokens;
        continue;
      }
      break;
    }

    const summary = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n').trim();
    await finishTask(taskId, { status: 'done', result: `${proposals} proposal(s). ${summary}`.slice(0, 4000), inputTokens: totalInput, outputTokens: totalOutput });

    if (proposals > 0) {
      const digest = `🧠 Auto-research: ${proposals} improvement${proposals === 1 ? '' : 's'} proposed.\n${summary.slice(0, 400)}\nReview at /drafts`;
      const fan: Promise<unknown>[] = [
        createNotification({ type: 'custom', severity: 'info', title: `${proposals} improvement proposal${proposals === 1 ? '' : 's'}`, message: summary.slice(0, 200) || 'See /drafts', data: { source: 'improver' } }),
      ];
      if (isSlackConfigured()) fan.push(sendSlack(digest));
      if (isLoopMessageConfigured()) fan.push(sendIMessage(digest, { agent: 'improver' }));
      await Promise.allSettled(fan);
    }

    return { ok: true, proposals, summary };
  } catch (err) {
    const m = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    await finishTask(taskId, { status: 'error', error: m, inputTokens: totalInput, outputTokens: totalOutput });
    return { ok: false, proposals, error: m };
  }
}
