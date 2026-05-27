import Anthropic from '@anthropic-ai/sdk';
import { after } from 'next/server';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sql, tenantId } from './db/client';
import { sendIMessage } from './loopmessage';
import { spawnSubAgent, SUBAGENT_REGISTRY } from './subagent';
import { startTask, finishTask } from './agent-tasks';
import { listActiveGoals, createGoal, appendProgress, updateGoalStatus, type GoalStatus } from './goals';
import { createDraft, listDrafts, publishContent, sendEmail, confirmMeeting, type DraftType } from './drafts';
import { kgToolDefinitions, handleKgTool } from './kg-tools';
import { parseAttachments, buildUserContent } from './vision';
import { estimateCostUsd } from './usage';
import { launchResearchCampaign } from './campaign-intake';
import { runAndChain } from './waves';
import { listSpawnableSpecs } from './agent-defs';

export interface OrchestratorUsage { input: number; output: number; cost_usd: number; model: string }

const MODEL = 'claude-sonnet-4-6';
const HISTORY_LIMIT = 24;
const TEMPLATE_DIR = join(process.cwd(), 'agents/keyplayer');
const STATE_DIR = join(process.cwd(), 'state/keyplayer');

interface ConfigVars {
  CLIENT_NAME: string;
  CLIENT_DESCRIPTION: string;
  OWNER_FIRST_NAME: string;
  OWNER_PHONE: string;
  [key: string]: unknown;
}

// Cache the stable template (soul + agent + skills + interpolated vars) in module
// memory. memory.md is read fresh per call since it changes over time — and it's
// placed AFTER the cache breakpoint so the prefix stays valid for prompt caching.
let cachedTemplate: string | null = null;

function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  const config = JSON.parse(readFileSync(join(STATE_DIR, 'config.json'), 'utf-8')) as ConfigVars;
  const soul = readFileSync(join(TEMPLATE_DIR, 'soul.md'), 'utf-8');
  const agent = readFileSync(join(TEMPLATE_DIR, 'agent.md'), 'utf-8');
  const skills = readFileSync(join(TEMPLATE_DIR, 'skills.md'), 'utf-8');
  let combined = [soul, agent, skills].join('\n\n---\n\n');
  for (const [k, v] of Object.entries(config)) {
    if (typeof v === 'string') combined = combined.replaceAll(`{{${k}}}`, v);
  }
  cachedTemplate = combined;
  return combined;
}

async function loadCurrentMemory(): Promise<string | null> {
  // Read the most recent compactor rollups from the agent_memory table (newest
  // last), concatenated — preserves the previous "recent rollups" behavior that
  // used to come from state/keyplayer/memory.md.
  try {
    const rows = (await sql()`
      SELECT rollup, created_at FROM agent_memory
      WHERE tenant_id = ${tenantId()}
      ORDER BY created_at DESC, id DESC
      LIMIT 3
    `) as unknown as Array<{ rollup: string; created_at: Date }>;
    if (rows.length === 0) return null;
    const recent = rows
      .reverse() // newest last
      .map((r) => `## Rollup ${new Date(r.created_at).toISOString().replace('T', ' ').replace(/\..+/, '')}\n\n${r.rollup.trim()}`)
      .join('\n\n---\n\n')
      .trim();
    return recent || null;
  } catch {
    return null;
  }
}

async function loadRecentHistory(limit = HISTORY_LIMIT): Promise<Anthropic.MessageParam[]> {
  const rows = (await sql()`
    SELECT direction, text, attachments FROM boardroom_messages
    WHERE tenant_id = ${tenantId()}
    ORDER BY id DESC LIMIT ${limit}
  `) as unknown as Array<{ direction: 'in' | 'out'; text: string; attachments: unknown }>;

  // Newest last. Keep rows that have text OR image attachments (image-only MMS
  // is valid). Inbound (user) rows with images get vision content blocks; the
  // images are downloaded and base64-encoded so Claude can actually see them.
  const ordered = rows.reverse();
  const out: Anthropic.MessageParam[] = [];
  for (const r of ordered) {
    const text = (r.text ?? '').trim();
    const attachments = r.direction === 'in' ? parseAttachments(r.attachments) : [];
    if (!text && attachments.length === 0) continue;

    if (r.direction === 'in' && attachments.length > 0) {
      out.push({ role: 'user', content: await buildUserContent(text, attachments) });
    } else {
      out.push({
        role: r.direction === 'in' ? 'user' : 'assistant',
        content: text,
      });
    }
  }
  return out;
}

async function buildTools(): Promise<Anthropic.Messages.ToolUnion[]> {
  // Roster from the live DB (Agent Studio) so newly-created specialists become
  // spawnable by KeyPlayer; fall back to the hardcoded registry if unseeded.
  let specs = await listSpawnableSpecs().catch(() => [] as Array<{ id: string; description: string }>);
  if (specs.length === 0) {
    specs = Object.values(SUBAGENT_REGISTRY).map((s) => ({ id: s.id, description: s.description }));
  }
  const subagentTypes = specs.map((s) => s.id);
  const subagentDescriptions = specs.map((s) => `- \`${s.id}\` — ${s.description}`).join('\n');

  return [
    { type: 'web_search_20250305', name: 'web_search' },
    {
      name: 'notify_owner',
      description:
        'Send a status update or notification to the owner via iMessage. Use this for live progress updates on long tasks (>5 min), urgent escalations, or to surface intermediate findings. The owner already receives your final reply automatically — only use notify_owner for *additional* mid-task pings.',
      input_schema: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The message text to send via iMessage.' },
        },
        required: ['text'],
      },
    },
    // ── Goals tools ──────────────────────────────────────────────────────────
    {
      name: 'list_goals',
      description: 'List active and pending-verification goals from goals.md. Use at the start of a turn if the request mentions goals, deadlines, or progress.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'create_goal',
      description: 'Create a new goal. Use sparingly — only when the owner explicitly states a goal with a measurable success criterion. Never create a goal from a vague intent.',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: 'Short title, e.g. "Reach $10K MRR"' },
          success: { type: 'string', description: 'How we know it is done — must be verifiable.' },
          due: { type: 'string', description: 'ISO date (YYYY-MM-DD) or empty if no deadline' },
        },
        required: ['title', 'success'],
      },
    },
    {
      name: 'update_goal_progress',
      description: 'Append a progress entry to an existing goal. Use after a material step (sub-agent finished, milestone hit, owner-confirmed action).',
      input_schema: {
        type: 'object',
        properties: {
          goal_id: { type: 'string', description: 'The goal id, e.g. g-2026-05-19-abc123' },
          note: { type: 'string', description: 'What happened, in one sentence.' },
        },
        required: ['goal_id', 'note'],
      },
    },
    {
      name: 'mark_goal_done',
      description: 'Mark a goal as done when its success criteria are verifiably met. The owner can revert via the dashboard. Per soul.md: cite the evidence in the note.',
      input_schema: {
        type: 'object',
        properties: {
          goal_id: { type: 'string' },
          evidence: { type: 'string', description: 'Concrete evidence the success criteria were met.' },
        },
        required: ['goal_id', 'evidence'],
      },
    },

    // ── Drafts tools ─────────────────────────────────────────────────────────
    {
      name: 'save_draft',
      description: 'Save a draft (content post, email, meeting proposal, campaign) for owner review. Drafts start with status=pending and require explicit approval before any publish/send/confirm tool will execute them. Use this for anything you would otherwise just describe in your reply — it gives the owner a single Drafts queue to act on.',
      input_schema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['content_post', 'email', 'meeting', 'campaign', 'other'],
            description: 'Category of the draft.',
          },
          title: { type: 'string', description: 'Short label so the owner can scan the queue.' },
          payload: { type: 'string', description: 'The actual draft content (post text, email body, meeting proposal, etc).' },
        },
        required: ['type', 'title', 'payload'],
      },
    },
    {
      name: 'list_pending_drafts',
      description: 'List drafts awaiting owner review. Use when the owner asks "what is waiting on me" or before reporting status.',
      input_schema: { type: 'object', properties: {}, additionalProperties: false },
    },
    {
      name: 'publish_content',
      description: 'Publish an approved content_post draft. Returns an error if the draft is not status=approved. In V1 this simulates publishing — actual social platform APIs will be wired later.',
      input_schema: {
        type: 'object',
        properties: { draft_id: { type: 'number' } },
        required: ['draft_id'],
      },
    },
    {
      name: 'send_email_draft',
      description: 'Send an approved email draft. Returns an error if the draft is not status=approved. In V1 this simulates sending — actual SMTP/Gmail wiring will come later.',
      input_schema: {
        type: 'object',
        properties: { draft_id: { type: 'number' } },
        required: ['draft_id'],
      },
    },
    {
      name: 'confirm_meeting_draft',
      description: 'Confirm an approved meeting draft to the live calendar. Returns an error if not approved. In V1 this simulates confirmation.',
      input_schema: {
        type: 'object',
        properties: { draft_id: { type: 'number' } },
        required: ['draft_id'],
      },
    },

    // ── Knowledge graph tools (shared definition; see ./kg-tools) ────────────
    ...kgToolDefinitions(),

    {
      name: 'spawn_subagent',
      description:
        `Spawn a specialist sub-agent to do focused work. Each sub-agent has its own scope, model, and token budget — picking the right type keeps cost low and quality high. Available sub-agents:\n${subagentDescriptions}\n\nReturns the sub-agent's output as text. The sub-agent's full conversation is logged to the Agent ↔ Agent boardroom for review.`,
      input_schema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: subagentTypes,
            description: 'Which sub-agent to spawn.',
          },
          task: {
            type: 'string',
            description: 'The specific task for the sub-agent — be precise about scope and what you need back.',
          },
        },
        required: ['type', 'task'],
      },
    },
    {
      name: 'launch_campaign',
      description:
        'Launch a full multi-wave RESEARCH CAMPAIGN (parallel agent waves with synthesis passed between waves) for a substantial question — market sizing, competitive landscape, go-to-market, deep due-diligence. It drafts a brief, creates a tracked goal from the success criterion, and starts wave 1; the owner advances later waves from /campaigns. Use this (NOT spawn_subagent) when the owner asks for *thorough/deep* research that deserves multiple angles. For a quick one-off lookup, use spawn_subagent with research-analyst instead.',
      input_schema: {
        type: 'object',
        properties: {
          request: { type: 'string', description: 'The research request in plain language — what to research and for what decision.' },
        },
        required: ['request'],
      },
    },
  ];
}

async function callClaude(
  client: Anthropic,
  template: string,
  memory: string | null,
  messages: Anthropic.MessageParam[],
): Promise<Anthropic.Message> {
  // Sonnet 4.6, thinking disabled. V1: the structured operating loop in agent.md
  // gives enough scaffolding without needing extended thinking, and disabling it
  // sidesteps a hang we saw with thinking blocks + parallel tool_use round-trips.
  // Template is cached. Memory section is appended after the cache breakpoint so
  // updates from memory-compactor don't bust the cache.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: template, cache_control: { type: 'ephemeral' } },
  ];
  if (memory) {
    systemBlocks.push({
      type: 'text',
      text: `# Compacted Memory (recent rollups)\n\n${memory}`,
    });
  }
  return client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemBlocks,
    tools: await buildTools(),
    messages,
  });
}

const CLIENT_TOOL_NAMES = new Set([
  'notify_owner',
  'spawn_subagent',
  'launch_campaign',
  'list_goals',
  'create_goal',
  'update_goal_progress',
  'mark_goal_done',
  'save_draft',
  'list_pending_drafts',
  'publish_content',
  'send_email_draft',
  'confirm_meeting_draft',
  'kg_remember',
  'kg_query',
]);

async function handleClientToolUse(
  toolUse: Anthropic.ToolUseBlock,
  parentTaskId: number,
): Promise<Anthropic.ToolResultBlockParam> {
  if (toolUse.name === 'notify_owner') {
    const text = (toolUse.input as { text?: string }).text?.trim();
    if (!text) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: notify_owner called without text.',
        is_error: true,
      };
    }
    const r = await sendIMessage(text, { agent: 'keyplayer' });
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: r.ok ? 'Sent iMessage to owner.' : `Failed to send: ${r.error}`,
      is_error: !r.ok,
    };
  }

  if (toolUse.name === 'spawn_subagent') {
    const input = toolUse.input as { type?: string; task?: string };
    if (!input.type || !input.task) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: spawn_subagent requires both `type` and `task`.',
        is_error: true,
      };
    }
    const result = await spawnSubAgent(input.type, input.task, parentTaskId);
    if (!result.ok) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Sub-agent ${input.type} failed: ${result.error}`,
        is_error: true,
      };
    }
    const usage = result.usage ? ` [tokens: ${result.usage.input} in / ${result.usage.output} out]` : '';
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Sub-agent ${input.type} returned:${usage}\n\n${result.text}`,
    };
  }

  if (toolUse.name === 'launch_campaign') {
    const request = (toolUse.input as { request?: string }).request?.trim();
    if (!request) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: launch_campaign requires a `request`.', is_error: true };
    }
    try {
      const launched = await launchResearchCampaign(request);
      // Start wave 1 in the background so KeyPlayer can ack the owner immediately.
      // after() runs the callback once the current request's response is sent; if
      // we're somehow outside a request context, the owner just advances manually.
      try {
        after(async () => {
          try { await runAndChain(launched.id); }
          catch (e) { console.error('[launch_campaign] wave 1 failed:', (e as Error).message); }
        });
      } catch { /* no request context — owner advances from /campaigns */ }
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Launched research campaign "${launched.title}" (goal ${launched.goalId}). Wave 1 is running now and the rest will auto-advance through to completion — watch it live at /tasks (Pipeline). Success criterion: ${launched.brief.success}`,
      };
    } catch (e) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Failed to launch campaign: ${(e as Error).message}`, is_error: true };
    }
  }

  // ── Goals tools ──────────────────────────────────────────────────────────
  if (toolUse.name === 'list_goals') {
    const goals = await listActiveGoals();
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: goals.length === 0
        ? 'No active or pending-verification goals.'
        : JSON.stringify(goals, null, 2),
    };
  }
  if (toolUse.name === 'create_goal') {
    const input = toolUse.input as { title?: string; success?: string; due?: string };
    if (!input.title || !input.success) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: title and success are required.', is_error: true };
    }
    const g = await createGoal({ title: input.title, success: input.success, due: input.due || null });
    return { type: 'tool_result', tool_use_id: toolUse.id, content: `Created goal ${g.id}: "${g.title}"` };
  }
  if (toolUse.name === 'update_goal_progress') {
    const input = toolUse.input as { goal_id?: string; note?: string };
    if (!input.goal_id || !input.note) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: goal_id and note are required.', is_error: true };
    }
    const g = await appendProgress(input.goal_id, input.note);
    return g
      ? { type: 'tool_result', tool_use_id: toolUse.id, content: `Progress logged on ${g.id}.` }
      : { type: 'tool_result', tool_use_id: toolUse.id, content: `No goal with id ${input.goal_id}.`, is_error: true };
  }
  if (toolUse.name === 'mark_goal_done') {
    const input = toolUse.input as { goal_id?: string; evidence?: string };
    if (!input.goal_id || !input.evidence) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: goal_id and evidence are required.', is_error: true };
    }
    const g = await updateGoalStatus(input.goal_id, 'done' as GoalStatus, input.evidence);
    return g
      ? { type: 'tool_result', tool_use_id: toolUse.id, content: `Marked ${g.id} as done. Owner can revert via dashboard.` }
      : { type: 'tool_result', tool_use_id: toolUse.id, content: `No goal with id ${input.goal_id}.`, is_error: true };
  }

  // ── Knowledge graph tools (shared handler; stamps source_agent='keyplayer') ─
  if (toolUse.name === 'kg_remember' || toolUse.name === 'kg_query') {
    return handleKgTool(toolUse, 'keyplayer');
  }

  // ── Drafts tools ─────────────────────────────────────────────────────────
  if (toolUse.name === 'save_draft') {
    const input = toolUse.input as { type?: DraftType; title?: string; payload?: string };
    if (!input.type || !input.title || !input.payload) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: type, title, and payload are required.', is_error: true };
    }
    try {
      const d = await createDraft({ type: input.type, title: input.title, payload: input.payload, createdBy: 'keyplayer' });
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Draft saved as id=${d.id} (status=pending). Owner reviews at /drafts.` };
    } catch (err) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${(err as Error).message}`, is_error: true };
    }
  }
  if (toolUse.name === 'list_pending_drafts') {
    const pending = await listDrafts({ status: 'pending', limit: 50 });
    if (pending.length === 0) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'No drafts awaiting review.' };
    }
    const summary = pending.map((d) => `- id=${d.id} [${d.type}] "${d.title}"`).join('\n');
    return { type: 'tool_result', tool_use_id: toolUse.id, content: `${pending.length} pending:\n${summary}` };
  }
  if (toolUse.name === 'publish_content' || toolUse.name === 'send_email_draft' || toolUse.name === 'confirm_meeting_draft') {
    const id = (toolUse.input as { draft_id?: number }).draft_id;
    if (typeof id !== 'number') {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: draft_id (number) is required.', is_error: true };
    }
    const fn = toolUse.name === 'publish_content' ? publishContent : toolUse.name === 'send_email_draft' ? sendEmail : confirmMeeting;
    const result = await fn(id);
    return result.ok
      ? { type: 'tool_result', tool_use_id: toolUse.id, content: `Executed: draft ${id} is now ${result.draft?.status}. ${result.draft?.execution_note ?? ''}` }
      : { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${result.error}`, is_error: true };
  }

  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: `Error: unknown tool ${toolUse.name}`,
    is_error: true,
  };
}

export async function runOrchestrator(): Promise<{ ok: true; text: string; usage: OrchestratorUsage } | { ok: false; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };
  }

  const client = new Anthropic({ maxRetries: 5 });
  const template = loadTemplate();
  const memory = await loadCurrentMemory();
  const messages = await loadRecentHistory();

  if (messages.length === 0) return { ok: false, error: 'No conversation history to respond to' };
  if (messages[messages.length - 1].role !== 'user') {
    return { ok: false, error: 'Latest message is not from the user; nothing to respond to' };
  }

  const lastContent = messages[messages.length - 1].content;
  const lastUserText = (
    typeof lastContent === 'string'
      ? lastContent
      : lastContent
          .filter((b): b is Anthropic.TextBlockParam => b.type === 'text')
          .map((b) => b.text)
          .join(' ') || '[image]'
  ).slice(0, 500);
  const orchestratorTaskId = await startTask('keyplayer', lastUserText);
  let totalInput = 0;
  let totalOutput = 0;
  const accumulateUsage = (r: Anthropic.Message) => {
    totalInput += r.usage.input_tokens ?? 0;
    totalOutput += r.usage.output_tokens ?? 0;
  };

  try {
    let response = await callClaude(client, template, memory, messages);
    let safetyCounter = 0;
    accumulateUsage(response);

    while (safetyCounter++ < 12) {
      if (response.stop_reason === 'end_turn') break;
      if (response.stop_reason === 'refusal') break;
      if (response.stop_reason === 'max_tokens') break;

      if (response.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: response.content });
        response = await callClaude(client, template, memory, messages);
        accumulateUsage(response);
        continue;
      }

      if (response.stop_reason === 'tool_use') {
        const clientToolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && CLIENT_TOOL_NAMES.has(b.name),
        );

        if (clientToolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = await Promise.all(
          clientToolUses.map((tu) => handleClientToolUse(tu, orchestratorTaskId)),
        );
        messages.push({ role: 'user', content: toolResults });
        response = await callClaude(client, template, memory, messages);
        accumulateUsage(response);
        continue;
      }

      break;
    }

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();

    if (!text) {
      await finishTask(orchestratorTaskId, { status: 'error', error: 'no text reply', inputTokens: totalInput, outputTokens: totalOutput });
      return { ok: false, error: 'Orchestrator produced no text reply' };
    }
    await finishTask(orchestratorTaskId, { status: 'done', result: text, inputTokens: totalInput, outputTokens: totalOutput });
    return {
      ok: true,
      text,
      usage: { input: totalInput, output: totalOutput, cost_usd: estimateCostUsd(MODEL, totalInput, totalOutput), model: MODEL },
    };
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    await finishTask(orchestratorTaskId, { status: 'error', error: msg, inputTokens: totalInput, outputTokens: totalOutput });
    return { ok: false, error: msg };
  }
}
