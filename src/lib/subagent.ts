import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';
import { startTask, finishTask, setTaskStream } from './agent-tasks';
import { kgToolDefinitions, handleKgTool } from './kg-tools';
import { chooseVariant } from './selection';
import { constraintsForVariant, roleFor } from './constraints';
import { selectGenesForTask, genesDirective, recordGeneApplications } from './genes';
import { getDefPrompt, getSpawnSpec } from './agent-defs';

const STATE_DIR = join(process.cwd(), 'state/keyplayer');
const SUBAGENT_DIR = join(process.cwd(), 'agents/sub-agents');

interface ConfigVars { [key: string]: unknown }

interface SubAgentSpec {
  id: string;
  model: string;
  maxTokens: number;
  ratePerHour: number;
  description: string;
}

// Registry: KeyPlayer can only spawn types listed here.
// To add a new sub-agent: create agents/sub-agents/<id>/ with soul.md+agent.md+skills.md,
// then add an entry below.
export const SUBAGENT_REGISTRY: Record<string, SubAgentSpec> = {
  'research-analyst': {
    id: 'research-analyst',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 10,
    description: 'Web research with citation-backed synthesis. Use for any claim that needs an external data source.',
  },
  'content-writer': {
    id: 'content-writer',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 20,
    description: 'Drafts social posts (X, LinkedIn, Instagram, Facebook, YouTube). Returns draft only — never publishes.',
  },
  'outreach-sender': {
    id: 'outreach-sender',
    model: 'claude-sonnet-4-6',
    maxTokens: 3072,
    ratePerHour: 30,
    description: 'Drafts cold/warm outreach emails or sequences. Returns draft only — never sends.',
  },
  'calendar-scheduler': {
    id: 'calendar-scheduler',
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
    ratePerHour: 60,
    description: 'Proposes 3 meeting time slots for a given purpose / duration. Returns proposals — owner confirms.',
  },
  'memory-compactor': {
    id: 'memory-compactor',
    model: 'claude-haiku-4-5',
    maxTokens: 2048,
    ratePerHour: 12,
    description: 'Compacts recent message history into a structured rollup (focus, threads, decisions, commitments).',
  },
  'lead-research': {
    id: 'lead-research',
    model: 'claude-sonnet-4-6',
    maxTokens: 2048,
    ratePerHour: 30,
    description: 'Builds a one-page profile of a prospect from public web signals. Read-only, source-cited.',
  },
  'thumbnail-generator': {
    id: 'thumbnail-generator',
    model: 'claude-haiku-4-5',
    maxTokens: 1024,
    ratePerHour: 60,
    description: 'Produces a thumbnail / cover-image spec (composition, palette, prompt). Spec only — no image generated.',
  },
  'hyperframes-agent': {
    id: 'hyperframes-agent',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 10,
    description: 'Drafts short-form video scripts + storyboards for HeyGen Hyperframes or video-use pipelines.',
  },
};

// In-memory rate limit window. Resets on server restart, which is fine for V1.
// Production: move to DB or Redis.
const rateLog = new Map<string, number[]>();

function checkRate(type: string): { allowed: true } | { allowed: false; resetInSec: number } {
  const spec = SUBAGENT_REGISTRY[type];
  if (!spec) return { allowed: true };
  const now = Date.now();
  const oneHourAgo = now - 3600_000;
  const recent = (rateLog.get(type) ?? []).filter((t) => t > oneHourAgo);
  if (recent.length >= spec.ratePerHour) {
    const oldest = Math.min(...recent);
    const resetInSec = Math.ceil((oldest + 3600_000 - now) / 1000);
    return { allowed: false, resetInSec };
  }
  recent.push(now);
  rateLog.set(type, recent);
  return { allowed: true };
}

// Load a sub-agent's system prompt. Prefer the live DB definition (Agent Studio);
// fall back to the bundled agents/** files. Then substitute {{CONFIG}} vars.
async function loadSubAgentSystemPrompt(type: string): Promise<string> {
  let combined = await getDefPrompt(type).catch(() => null);
  if (!combined) {
    const dir = join(SUBAGENT_DIR, type);
    if (!existsSync(dir)) throw new Error(`Sub-agent template not found: ${type}`);
    const parts = ['soul.md', 'agent.md', 'skills.md']
      .map((f) => { try { return readFileSync(join(dir, f), 'utf-8'); } catch { return ''; } })
      .filter(Boolean);
    combined = parts.join('\n\n---\n\n');
  }
  try {
    const config = JSON.parse(readFileSync(join(STATE_DIR, 'config.json'), 'utf-8')) as ConfigVars;
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === 'string') combined = combined.replaceAll(`{{${k}}}`, v);
    }
  } catch { /* no config file — leave placeholders as-is */ }
  return combined;
}

async function logA2A(from: string, to: string, content: string, metadata: Record<string, unknown> = {}) {
  const conversationId = `mc:a2a:${from}:${to}`;
  await sql()`
    INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type, metadata)
    VALUES (
      ${DEFAULT_TENANT_ID}, ${conversationId}, ${from}, ${to}, ${content}, 'text',
      ${jsonb({ source: 'subagent', ...metadata })}
    )
  `;
}

export interface SpawnResult {
  ok: boolean;
  text?: string;
  error?: string;
  usage?: { input: number; output: number };
  variant?: string; // constraint variant chosen for this run (Phase 3 selection)
}

interface BoardroomRow { direction: 'in' | 'out'; sender: string; text: string; created_at: Date }
interface TaskHistoryRow { agent_id: string; status: string; task: string; result: string | null; started_at: Date }

function fmtTs(ts: Date): string { return new Date(ts).toISOString().replace('T', ' ').replace(/\..+/, ''); }

async function buildMemoryCompactorPayload(originalInstruction: string): Promise<string> {
  const boardroom = (await sql()`
    SELECT direction, sender, text, created_at FROM boardroom_messages
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY created_at DESC LIMIT 50
  `) as unknown as BoardroomRow[];
  const tasks = (await sql()`
    SELECT agent_id, status, task, result, started_at FROM agent_tasks
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY started_at DESC LIMIT 30
  `) as unknown as TaskHistoryRow[];

  const lines: string[] = [];
  lines.push(`# Instruction from orchestrator`);
  lines.push(originalInstruction || 'Compact recent activity into a rollup. Use the output schema in your agent.md.');
  lines.push('');
  lines.push(`# Recent boardroom (${boardroom.length} messages, oldest first)`);
  for (const r of boardroom.slice().reverse()) {
    const who = r.direction === 'in' ? 'OWNER' : (r.sender || 'AGENT');
    lines.push(`[${fmtTs(r.created_at)}] ${who}: ${r.text}`);
  }
  lines.push('');
  lines.push(`# Recent agent tasks (${tasks.length}, oldest first)`);
  for (const r of tasks.slice().reverse()) {
    const tail = r.result ? ` → ${r.result.slice(0, 240).replace(/\s+/g, ' ')}` : '';
    lines.push(`[${fmtTs(r.started_at)}] ${r.agent_id} [${r.status}]: ${r.task.slice(0, 240)}${tail}`);
  }
  return lines.join('\n');
}

// Persist a compactor rollup into the `agent_memory` table (Supabase Postgres).
// Replaces the previous append to state/keyplayer/memory.md so it works on a
// read-only serverless host. The orchestrator's loadCurrentMemory() reads the
// most recent rows back on its next call.
async function persistMemoryRollup(rollupText: string): Promise<void> {
  try {
    await sql()`
      INSERT INTO agent_memory (tenant_id, rollup)
      VALUES (${DEFAULT_TENANT_ID}, ${rollupText.trim()})
    `;
  } catch (err) {
    console.error('[memory-compactor] failed to persist rollup:', (err as Error).message);
  }
}

export async function spawnSubAgent(type: string, task: string, parentTaskId?: number, opts?: { variant?: string; maxTurns?: number }): Promise<SpawnResult> {
  // Resolve the spec from the live DB roster (Agent Studio); fall back to the
  // hardcoded registry for builtins that haven't been seeded into the DB.
  const spec = (await getSpawnSpec(type).catch(() => null)) ?? SUBAGENT_REGISTRY[type];
  if (!spec) return { ok: false, error: `Unknown sub-agent type: ${type}. Available: ${Object.keys(SUBAGENT_REGISTRY).join(', ')}` };
  let variant = opts?.variant ?? 'base';

  const rate = checkRate(type);
  if (!rate.allowed) {
    return { ok: false, error: `Rate limit exceeded for ${type} (${spec.ratePerHour}/hr). Resets in ${rate.resetInSec}s.` };
  }

  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: 'ANTHROPIC_API_KEY not configured' };

  // Pick the constraint variant centrally so EVERY spawn (orchestrator, waves,
  // cron, A2A) gets selection + the variant's constraints — not just some paths.
  // Callers may pre-pick (e.g. a wave passes its choice); otherwise choose now.
  if (!opts?.variant) variant = await chooseVariant(roleFor(type), type);

  // Auto-hydrate memory-compactor with raw boardroom + task history.
  // KeyPlayer just needs to ask for it — runtime supplies the data.
  let hydratedTask = task;
  if (type === 'memory-compactor') {
    hydratedTask = await buildMemoryCompactorPayload(task);
  }
  // Append the chosen variant's role constraints (Phase 2 + selection).
  hydratedTask = `${hydratedTask}\n\n# ${constraintsForVariant(type, variant)}`;

  // Inject owner-approved strategy genes for this agent (self-improving loop).
  // Returns [] when the feature is off or no active gene matches — so this is a
  // no-op until the owner approves a gene, keeping behavior identical to before.
  const genes = await selectGenesForTask(type).catch(() => []);
  if (genes.length > 0) hydratedTask = `${hydratedTask}\n\n# ${genesDirective(genes)}`;
  const geneIds = genes.map((g) => g.id);

  // Live-tasks tracking. Record the constraint variant + any applied genes so the
  // reward loop can attribute this run's score to (role, agent, variant) and genes.
  const taskId = await startTask(type, task, parentTaskId, { variant, genes: geneIds });
  if (geneIds.length > 0) await recordGeneApplications(geneIds, taskId).catch(() => {});
  // Log the dispatch (from keyplayer -> sub-agent)
  await logA2A('keyplayer', type, task, { phase: 'dispatch', task_id: taskId });

  const client = new Anthropic({ maxRetries: 5 });
  const systemPrompt = await loadSubAgentSystemPrompt(type);

  const tools: Anthropic.Messages.ToolUnion[] = [
    { type: 'web_search_20250305', name: 'web_search' },
    // Shared KG tools so every sub-agent can read/write the team's graph.
    ...kgToolDefinitions(),
  ];

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: hydratedTask }];

  // Live transcript: stream text deltas into the task's stream_text buffer so the
  // Tasks page can watch the run fill in. Writes are debounced to ~1/sec.
  let streamBuf = '';
  let lastWrite = 0;
  const onDelta = (t: string) => {
    streamBuf += t;
    const now = Date.now();
    if (now - lastWrite > 900) { lastWrite = now; void setTaskStream(taskId, streamBuf).catch(() => {}); }
  };
  const turn = async (): Promise<Anthropic.Message> => {
    const stream = client.messages.stream({
      model: spec.model,
      max_tokens: spec.maxTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });
    stream.on('text', onDelta);
    return stream.finalMessage();
  };

  try {
    let response = await turn();

    // Cap the tool-use loop. Each turn may include a (slow) server-side web_search,
    // so fewer turns = faster wall-clock + less chance of blowing the 300s function
    // limit. Callers in a wave pass a tighter cap; default stays generous.
    const maxTurns = Math.max(1, Math.min(opts?.maxTurns ?? 8, 12));
    let safety = 0;
    while (safety++ < maxTurns) {
      if (response.stop_reason === 'end_turn') break;
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') break;
      if (response.stop_reason === 'pause_turn') {
        // web_search runs server-side; just continue the paused turn.
        messages.push({ role: 'assistant', content: response.content });
        response = await turn();
        continue;
      }
      if (response.stop_reason === 'tool_use') {
        // Sub-agents can use the shared KG tools (kg_query / kg_remember).
        // Provenance: the sub-agent type id is the source agent.
        const kgToolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock =>
            b.type === 'tool_use' && (b.name === 'kg_query' || b.name === 'kg_remember'),
        );
        if (kgToolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults = await Promise.all(kgToolUses.map((tu) => handleKgTool(tu, type)));
        messages.push({ role: 'user', content: toolResults });
        response = await turn();
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
      await logA2A(type, 'keyplayer', '(no text returned)', { phase: 'result', stop_reason: response.stop_reason });
      await finishTask(taskId, { status: 'error', error: `no text (stop_reason: ${response.stop_reason})` });
      return { ok: false, error: `${type} returned no text (stop_reason: ${response.stop_reason})` };
    }

    await logA2A(type, 'keyplayer', text, {
      phase: 'result',
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    });

    // Persist memory-compactor rollups so KeyPlayer's next system-prompt load picks them up.
    if (type === 'memory-compactor') {
      await persistMemoryRollup(text);
    }

    await finishTask(taskId, {
      status: 'done',
      result: text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    return {
      ok: true,
      text,
      usage: { input: response.usage.input_tokens, output: response.usage.output_tokens },
      variant,
    };
  } catch (err) {
    const msg = err instanceof Anthropic.APIError ? `Anthropic ${err.status}: ${err.message}` : (err as Error).message;
    await logA2A(type, 'keyplayer', `ERROR: ${msg}`, { phase: 'error' });
    await finishTask(taskId, { status: 'error', error: msg });
    return { ok: false, error: msg };
  }
}
