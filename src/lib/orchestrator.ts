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
import { googleToolDefinitions, handleGoogleTool, googleActionsAllowed, GOOGLE_TOOL_NAMES } from './google-tools';
import { smsToolDefinitions, handleSmsTool, smsAllowed, SMS_TOOL_NAMES } from './sms-tools';
import { firecrawlToolDefinitions, handleFirecrawlTool, firecrawlAllowed, FIRECRAWL_TOOL_NAMES } from './firecrawl-tools';
import { parseAttachments, buildUserContent } from './vision';
import { estimateCostUsd } from './usage';
import { launchResearchCampaign } from './campaign-intake';
import { runAndChain } from './waves';
import { listSpawnableSpecs, getDefPrompt } from './agent-defs';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { buildMcpConfig, MCP_BETA, hasMcpBlock, type McpConfig } from './mcp-connector';
import { logAudit } from './audit';
import { toolApprovalsEnabled, isGatedTool } from './tool-approvals';

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

// Load KeyPlayer's stable system prompt (soul + agent + skills + interpolated
// vars). DB-first (Agent Studio) so prompt edits take effect live, mirroring
// subagent.ts loadSubAgentSystemPrompt; falls back to the bundled agents/keyplayer
// files. Read per-run (no module cache): one indexed query per run is negligible
// and a forever cache would silently ignore Studio edits. memory.md is read fresh
// per call too and placed AFTER the cache breakpoint so the cached prefix stays
// valid for prompt caching — so nothing per-run-varying enters this cached block.
async function loadTemplate(): Promise<string> {
  let combined = await getDefPrompt('keyplayer').catch(() => null);
  if (!combined) {
    const soul = readFileSync(join(TEMPLATE_DIR, 'soul.md'), 'utf-8');
    const agent = readFileSync(join(TEMPLATE_DIR, 'agent.md'), 'utf-8');
    const skills = readFileSync(join(TEMPLATE_DIR, 'skills.md'), 'utf-8');
    combined = [soul, agent, skills].join('\n\n---\n\n');
  }
  // Apply the config.json {{KEY}} substitution regardless of source.
  try {
    const config = JSON.parse(readFileSync(join(STATE_DIR, 'config.json'), 'utf-8')) as ConfigVars;
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === 'string') combined = combined.replaceAll(`{{${k}}}`, v);
    }
  } catch { /* no config file — leave placeholders as-is */ }
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

async function buildTools(gwAllowedArg?: boolean, smsOnArg?: boolean, fcOnArg?: boolean): Promise<Anthropic.Messages.ToolUnion[]> {
  // Roster from the live DB (Agent Studio) so newly-created specialists become
  // spawnable by KeyPlayer; fall back to the hardcoded registry if unseeded.
  let specs = await listSpawnableSpecs().catch(() => [] as Array<{ id: string; description: string }>);
  if (specs.length === 0) {
    specs = Object.values(SUBAGENT_REGISTRY).map((s) => ({ id: s.id, description: s.description }));
  }
  const subagentTypes = specs.map((s) => s.id);
  const subagentDescriptions = specs.map((s) => `- \`${s.id}\` — ${s.description}`).join('\n');

  // Offer the Google Workspace tools to KeyPlayer only when connected + opted in.
  // Reuse the caller's precomputed flag when given (avoids a duplicate DB read).
  const gwAllowed = gwAllowedArg ?? await googleActionsAllowed();
  const smsOn = smsOnArg ?? await smsAllowed();
  const fcOn = fcOnArg ?? await firecrawlAllowed();

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

    // ── Google Workspace tools — only when the tenant has connected Google AND
    //    opted in (default off). Same gate as the sub-agents; KeyPlayer itself
    //    can now create Docs/Sheets/folders, send Gmail, manage Calendar + Meet.
    ...(gwAllowed ? googleToolDefinitions() : []),

    // ── SMS (Twilio) — only when Twilio is connected. ────────────────────────
    ...(smsOn ? smsToolDefinitions() : []),

    // ── Firecrawl brand scraping — only when a Firecrawl key is connected. ────
    ...(fcOn ? await firecrawlToolDefinitions() : []),

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
          max_waves: { type: 'number', description: 'Optional cap on how many waves to run before stopping early (e.g. 3). Omit to run the full planned campaign.' },
          stop_when: { type: 'string', enum: ['goal_met', 'no_progress'], description: "Optional early-halt condition: 'goal_met' stops once the mission's goal is satisfied; 'no_progress' stops when a wave adds nothing new. Omit for no early halt." },
        },
        required: ['request'],
      },
    },
  ];
}

/** Parse the optional launch_campaign halt controls (the stopWhen kit) from a tool input. */
function parseLaunchHalt(input: Record<string, unknown>): { maxWaves: number | null; stopWhen: { condition: 'goal_met' | 'no_progress' } | null } {
  const n = Number(input.max_waves);
  const maxWaves = Number.isInteger(n) && n > 0 ? n : null;
  const sw = input.stop_when;
  const stopWhen = sw === 'goal_met' || sw === 'no_progress'
    ? { condition: sw as 'goal_met' | 'no_progress' }
    : null;
  return { maxWaves, stopWhen };
}

/** The latest user message's text (for KG-memory relevance). Scans from the end
 *  for a user turn that yields text; joins text parts when content is an array.
 *  Returns undefined when none is found (memory then falls back to top facts). */
function lastUserText(messages: Anthropic.MessageParam[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    const c = m.content;
    if (typeof c === 'string') {
      if (c.trim()) return c;
      continue;
    }
    if (Array.isArray(c)) {
      const text = c
        .map((b) => (b && typeof b === 'object' && 'type' in b && b.type === 'text'
          && typeof (b as { text?: unknown }).text === 'string'
          ? (b as { text: string }).text
          : ''))
        .filter(Boolean)
        .join(' ')
        .trim();
      if (text) return text;
    }
  }
  return undefined;
}

async function callClaude(
  client: Anthropic,
  template: string,
  memory: string | null,
  messages: Anthropic.MessageParam[],
  mcp: McpConfig | null,
): Promise<Anthropic.Message> {
  // Sonnet 4.6, thinking disabled. V1: the structured operating loop in agent.md
  // gives enough scaffolding without needing extended thinking, and disabling it
  // sidesteps a hang we saw with thinking blocks + parallel tool_use round-trips.
  // Template is cached. Memory section is appended after the cache breakpoint so
  // updates from memory-compactor don't bust the cache.
  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: 'text', text: template, cache_control: { type: 'ephemeral' } },
  ];
  // The company playbook (objectives, ICP, voice, constraints) — so the orchestrator
  // speaks for the business, not generically. Empty until the owner generates one.
  try {
    const { companyContextBlock } = await import('./company-playbook');
    const ctx = await companyContextBlock();
    if (ctx) systemBlocks.push({ type: 'text', text: ctx });
  } catch { /* best-effort context */ }
  // Active documents (status="wiki") the owner marked as standing SOPs — injected
  // as long-term context so the orchestrator follows them. Empty when none active.
  try {
    const { companyKnowledgeBlock } = await import('./knowledge-context');
    const kb = await companyKnowledgeBlock();
    if (kb) systemBlocks.push({ type: 'text', text: kb });
  } catch { /* best-effort context */ }
  // Persistent memory (RAG-style) — always-on recall of durable facts from the
  // knowledge graph, biased by the latest user message so the orchestrator reuses
  // what we already know instead of re-asking. Empty when the KG has nothing.
  try {
    const { relevantMemoryBlock } = await import('./kg-context');
    const rm = await relevantMemoryBlock(lastUserText(messages));
    if (rm) systemBlocks.push({ type: 'text', text: rm });
  } catch { /* best-effort memory */ }
  if (memory) {
    systemBlocks.push({
      type: 'text',
      text: `# Compacted Memory (recent rollups)\n\n${memory}`,
    });
  }
  // Google Workspace capability note — only when connected + opted in. The base
  // skills.md enumerates a fixed tool list (web_search / notify_owner /
  // spawn_subagent), so without this the model "believes" it lacks Google access
  // and refuses even though the gw_*/gmail_*/cal_*/meet_* tools ARE in its array.
  // Computed once and reused for the tools array so we don't double the DB reads.
  const gwAllowed = await googleActionsAllowed().catch(() => false);
  if (gwAllowed) {
    systemBlocks.push({
      type: 'text',
      text:
        '# Google Workspace is connected — you can act on it NOW\n' +
        'Google is connected and actions are enabled, so you have these LIVE tools. ' +
        "Use them directly when asked — do NOT say you lack Google/Drive access:\n" +
        '- `gw_create_folder`, `gw_create_doc`, `gw_append_doc`, `gw_create_sheet`, `gw_append_sheet_row`, `gw_list_files` — Drive / Docs / Sheets\n' +
        '- `gmail_list`, `gmail_send` (sends a REAL email), `gmail_draft` — Gmail\n' +
        '- `cal_list`, `cal_create_event` — Calendar\n' +
        '- `meet_create_space`, `meet_recent_transcript` — Google Meet\n' +
        "They act on the owner's real connected Google account; every write is audit-logged.",
    });
  }
  // Messaging capability note — only when a provider is connected (same
  // prompt-awareness reason as Google: the base skills list doesn't mention it).
  const smsOn = await smsAllowed().catch(() => false);
  if (smsOn) {
    systemBlocks.push({
      type: 'text',
      text:
        '# Messaging is connected\n' +
        'You can send a real text message to a contact via the `sms_send` tool (to a phone ' +
        'number, any common format — it normalises to E.164). It routes over the workspace’s ' +
        'connected provider — Twilio SMS and/or LoopMessage iMessage — choosing the channel ' +
        'automatically, so just pass `to` and `body` (do not set `channel` unless you must force ' +
        'one). It sends a real message that costs money — use it when the owner asks you to text ' +
        'someone or for a genuine time-sensitive alert. Every send is audit-logged.',
    });
  }
  // Firecrawl capability note — only when a key is connected (same
  // prompt-awareness reason as Google/SMS: the base skills list doesn't mention it).
  const fcOn = await firecrawlAllowed().catch(() => false);
  if (fcOn) {
    systemBlocks.push({
      type: 'text',
      text:
        '# Brand scraping is connected\n' +
        'You can scrape ANY public website with the `scrape_brand` tool — pass a `url` and it ' +
        'returns the brand identity (name, tagline, colors, fonts, logo, social links) plus ' +
        'clean markdown of the page. Use it to ground brand, design, or competitive work in the ' +
        'real source — a competitor’s site, a prospect’s homepage, or the workspace’s own page — ' +
        'instead of guessing. Do NOT claim you cannot read websites when this tool is available.',
    });
  }
  const tools = await buildTools(gwAllowed, smsOn, fcOn);

  // MCP HUB — when the tenant has >=1 enabled MCP server, add mcp_servers + the
  // mcp_toolset entries + the connector beta header so KeyPlayer can call those
  // servers' tools (Anthropic runs them server-side, like web_search). When `mcp`
  // is null (the default + common case) this is the EXACT request as before — no
  // mcp_servers, no beta header, no extra tools, no behavior change. A bad beta
  // shape degrades to the normal call (caught here, then again by the caller).
  if (mcp) {
    try {
      return (await client.beta.messages.create({
        model: MODEL,
        max_tokens: 8000,
        system: systemBlocks,
        tools: [...tools, ...mcp.toolsets] as Anthropic.Beta.Messages.BetaToolUnion[],
        mcp_servers: mcp.mcp_servers,
        messages: messages as Anthropic.Beta.Messages.BetaMessageParam[],
        betas: [MCP_BETA],
      })) as unknown as Anthropic.Message;
    } catch (err) {
      console.error('[mcp] beta call failed for keyplayer, falling back:', (err as Error).message);
      // fall through to the normal call
    }
  }

  return client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: systemBlocks,
    tools,
    messages,
  });
}

const CLIENT_TOOL_NAMES = new Set<string>([
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
  // Google Workspace tools (present only when gated on) must be recognized here
  // too, or the loop won't process them and the turn ends with no text reply.
  ...GOOGLE_TOOL_NAMES,
  // SMS (Twilio) — same requirement: recognize the name or the loop bails.
  ...SMS_TOOL_NAMES,
  // Firecrawl brand scraping — same requirement: recognize the name or the loop bails.
  ...FIRECRAWL_TOOL_NAMES,
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
    // Owner-approval gate (OPT-IN via TOOL_APPROVALS_ENABLED; default OFF → no change).
    // Held ≠ failed: return a normal tool_result (no is_error) so the model acks the owner.
    if (toolApprovalsEnabled() && isGatedTool(toolUse.name)) {
      const { createToolCallApproval } = await import('./pending-approvals');
      const id = await createToolCallApproval({
        tool: toolUse.name,
        input: { type: input.type, task: input.task },
        summary: `Spawn ${input.type} sub-agent: ${input.task}`,
      });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Held for owner approval (#${id}). The ${input.type} sub-agent will run once the owner approves.`,
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
    const input = toolUse.input as Record<string, unknown>;
    const request = (input.request as string | undefined)?.trim();
    if (!request) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: launch_campaign requires a `request`.', is_error: true };
    }
    // Optional early-halt controls (the stopWhen kit). Null/omitted = run the full campaign.
    const { maxWaves, stopWhen } = parseLaunchHalt(input);
    const haltNote = maxWaves ? ` (cap ${maxWaves} waves)` : stopWhen ? ` (stop when ${stopWhen.condition})` : '';
    // Owner-approval gate (OPT-IN via TOOL_APPROVALS_ENABLED; default OFF → no change).
    // Held ≠ failed: return a normal tool_result (no is_error) so the model acks the owner.
    if (toolApprovalsEnabled() && isGatedTool(toolUse.name)) {
      const { createToolCallApproval } = await import('./pending-approvals');
      const id = await createToolCallApproval({
        tool: toolUse.name,
        // Carry the halt controls so the held-then-approved launch applies them too.
        input: { request, max_waves: maxWaves, stop_when: stopWhen?.condition ?? null },
        summary: `Launch research campaign${haltNote}: ${request}`,
      });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: `Held for owner approval (#${id}). The research campaign will launch once the owner approves.`,
      };
    }
    try {
      const launched = await launchResearchCampaign(request, { maxWaves, stopWhen });
      // Start wave 1 in the background so KeyPlayer can ack the owner immediately.
      // after() runs the callback once the current request's response is sent; if
      // we're somehow outside a request context, the owner just advances manually.
      try {
        after(async () => {
          try { await runAndChain(launched.id); }
          catch (e) { console.error('[launch_campaign] wave 1 failed:', (e as Error).message); }
        });
      } catch { /* no request context — owner advances from /missions */ }
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

  // ── Google Workspace tools (only present when gated on; shared handler) ──────
  if ((GOOGLE_TOOL_NAMES as readonly string[]).includes(toolUse.name)) {
    return handleGoogleTool(toolUse, 'keyplayer');
  }

  // ── SMS (Twilio) tool (only present when connected; shared handler) ──────────
  if ((SMS_TOOL_NAMES as readonly string[]).includes(toolUse.name)) {
    return handleSmsTool(toolUse, 'keyplayer');
  }

  // ── Firecrawl brand scraping (only present when connected; shared handler) ───
  if (FIRECRAWL_TOOL_NAMES.has(toolUse.name)) {
    return handleFirecrawlTool(toolUse);
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
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return { ok: false, error: NO_ANTHROPIC_KEY_MESSAGE };
  }

  const client = new Anthropic({ apiKey, maxRetries: 5 });
  const template = await loadTemplate();
  const memory = await loadCurrentMemory();
  const messages = await loadRecentHistory();

  // MCP HUB — the tenant's enabled MCP servers for THIS run (null when none, which
  // is the default + common case). Built once and threaded through every callClaude
  // turn. Best-effort; never blocks the run.
  const mcp = await buildMcpConfig().catch(() => null);
  if (mcp) {
    void logAudit({ actor: null, action: 'mcp.run.enabled', target: 'keyplayer', detail: { servers: mcp.serverNames } }).catch(() => {});
  }

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
    let response = await callClaude(client, template, memory, messages, mcp);
    let safetyCounter = 0;
    accumulateUsage(response);

    while (safetyCounter++ < 12) {
      if (response.stop_reason === 'end_turn') break;
      if (response.stop_reason === 'refusal') break;
      if (response.stop_reason === 'max_tokens') break;

      if (response.stop_reason === 'pause_turn') {
        // web_search AND MCP connector tools both run server-side and surface as
        // pause_turn; re-send to resume the paused turn.
        messages.push({ role: 'assistant', content: response.content });
        response = await callClaude(client, template, memory, messages, mcp);
        accumulateUsage(response);
        continue;
      }

      if (response.stop_reason === 'tool_use') {
        const clientToolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && CLIENT_TOOL_NAMES.has(b.name),
        );

        if (clientToolUses.length === 0) {
          // mcp_tool_use / mcp_tool_result blocks execute SERVER-SIDE (like
          // web_search) — they are NOT unhandled client tools. If the turn touched
          // MCP, continue it so the server can finish rather than breaking with no
          // text; otherwise it's a genuinely unhandled tool and we stop.
          if (mcp && hasMcpBlock(response.content)) {
            messages.push({ role: 'assistant', content: response.content });
            response = await callClaude(client, template, memory, messages, mcp);
            accumulateUsage(response);
            continue;
          }
          break;
        }

        messages.push({ role: 'assistant', content: response.content });

        const toolResults = await Promise.all(
          clientToolUses.map((tu) => handleClientToolUse(tu, orchestratorTaskId)),
        );
        messages.push({ role: 'user', content: toolResults });
        response = await callClaude(client, template, memory, messages, mcp);
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
