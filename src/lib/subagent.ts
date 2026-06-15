import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql, jsonb, tenantId } from './db/client';
import { getAnthropicKey } from './anthropic-key';
import { startTask, finishTask, setTaskStream } from './agent-tasks';
import { kgToolDefinitions, handleKgTool } from './kg-tools';
import { skillRecallToolDefinitions, handleSkillRecallTool } from './skill-recall';
import { googleToolDefinitions, handleGoogleTool, googleActionsAllowed, GOOGLE_TOOL_NAMES } from './google-tools';
import { smsToolDefinitions, handleSmsTool, smsAllowed, SMS_TOOL_NAMES } from './sms-tools';
import { chooseVariant } from './selection';
import { constraintsForVariant, roleFor } from './constraints';
import { selectGenesForTask, genesDirective, recordGeneApplications } from './genes';
import { logTimeSaving, actionTypeForAgent } from './roi';
import { getDefPrompt, getSpawnSpec } from './agent-defs';
import { heartbeat } from './heartbeat';
import { getOwnedGoalForAgent, observeMessage } from './goal-observer';
import { assertWithinBudget, BudgetExceededError } from './usage-cap';

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
  'reel-analyst': {
    id: 'reel-analyst',
    // Cheap by default: a teardown from the caption/metrics/transcript it's
    // handed is squarely in Haiku's lane, and reel-intel spawns it TOOL-FREE
    // (single turn). "Deep analyze" upgrades the spawn to Sonnet + web_search.
    model: 'claude-haiku-4-5',
    maxTokens: 1500,
    ratePerHour: 30,
    description: 'Reverse-engineers why a competitor short-form video (Reel/Short/TikTok) performed — from its transcript + caption + metrics. Extracts the winning hook, key phrases, structure, and an adaptable angle. Research/teardown only; hands the angle to hyperframes-agent for a script.',
  },
  'reel-ideator': {
    id: 'reel-ideator',
    model: 'claude-haiku-4-5',
    maxTokens: 1200,
    ratePerHour: 30,
    description: 'Turns live trends + competitor wins into a batch of fresh, testable short-form reel CONCEPTS (hook/angle/format) for the client to curate. Ideas only.',
  },
  'reel-optimizer': {
    id: 'reel-optimizer',
    model: 'claude-sonnet-4-6',
    maxTokens: 3000,
    ratePerHour: 20,
    description: 'Deep optimizer for the owner OWN short-form reel: scores it, finds timestamped weak points, and writes goal-tailored Currently/Try/Expected-impact rewrites from its transcript + real IG metrics.',
  },
  'content-cascade': {
    id: 'content-cascade',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 12,
    description: 'Repurposes ONE pillar piece into five platform-native drafts (X thread, LinkedIn post, IG caption + hashtags, YouTube Short beat sheet, newsletter blurb) — one ## section per platform for splitting into content_post drafts. Drafts only — never publishes.',
  },
  'carousel-generator': {
    id: 'carousel-generator',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 20,
    description: 'Turns a topic or pillar piece into a 6-10 slide IG/LinkedIn carousel script (hook slide -> value arc -> CTA, with per-slide visual notes for thumbnail-generator). Script only - never publishes.',
  },
  'inbox-triage': {
    id: 'inbox-triage',
    // Classification over email rows it's already handed — Haiku's lane.
    // Spawn it TOOL-FREE (single turn): the batch arrives in the prompt,
    // there is nothing to fetch.
    model: 'claude-haiku-4-5',
    maxTokens: 2048,
    ratePerHour: 30,
    description: 'Triages a batch of inbound emails (act_now / draft_reply / delegate / archive / spam) with one-line reasoning + suggested replies for the draft-worthy ones. Verdicts only — never sends; KeyPlayer turns draft_reply rows into drafts.',
  },
  'client-onboarding-doc': {
    id: 'client-onboarding-doc',
    // Low rate on purpose: this runs roughly once per newly signed client
    // (plus the occasional regenerate), and each run is a long-form Sonnet doc.
    model: 'claude-sonnet-4-6',
    maxTokens: 6144,
    ratePerHour: 6,
    description: 'Drafts the client-facing onboarding document (welcome, cadence + channels, first-30-days plan, needs-from-client checklist, key contacts, success metrics tied to goals) from the company brief + intake answers. Returns a KB draft for owner approval + PDF export — never sends.',
  },
  'scope-of-work': {
    id: 'scope-of-work',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 10,
    description: 'Drafts a markdown scope-of-work from a goal/brief: objectives, itemized deliverables (quantities + cadence), explicit out-of-scope list, milestones, revision policy, and a pricing table with {{PRICE_*}} placeholders. Draft only — never sends, never invents prices or legal terms.',
  },
  'weekly-client-status': {
    id: 'weekly-client-status',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 10,
    description: 'Composes the weekly client status report (wins, in-flight, blocked + asks, next-week plan, metrics snapshot) from the structured weekly context it is handed. Email-ready markdown draft — never sends; flags missing data instead of inventing it.',
  },
  'deliverable-qa': {
    id: 'deliverable-qa',
    model: 'claude-sonnet-4-6',
    maxTokens: 3072,
    ratePerHour: 30,
    description: 'Adversarial QA of a deliverable draft against the company brief, brand voice and original task. Returns a ship/fix/redo verdict + scored rubric + diff-style line edits — flags unverifiable claims, never publishes or approves.',
  },
  'pipeline-review': {
    id: 'pipeline-review',
    model: 'claude-sonnet-4-6',
    maxTokens: 3072,
    ratePerHour: 12,
    description: 'Reviews a CRM pipeline snapshot handed in the prompt: stalled deals (>14d idle) with unstick actions, stage-conversion red flags, top-5 focus list (expected value × momentum), one-paragraph forecast. Brief only — never touches the CRM.',
  },
  'sponsor-pitch': {
    id: 'sponsor-pitch',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    ratePerHour: 10,
    description: 'Builds a sponsor pitch one-pager from supplied audience stats + a brand-fit hypothesis: positioning line, honest numbers (flags stats >90 days old), three packages with placeholder pricing, single next step. Draft only — never sends.',
  },
  'community-pulse': {
    id: 'community-pulse',
    model: 'claude-haiku-4-5',
    maxTokens: 2500,
    ratePerHour: 12,
    description: 'Digests a batch of community signals (YouTube/IG comments, DMs, mentions handed in the prompt) into one markdown pulse: 1–10 sentiment temperature + trend vs last digest, top themes with verbatim quotes, reply-worthy members, and content the community is implicitly asking for. Digest only — never replies or posts.',
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
  // Prepend the tenant's company playbook so EVERY agent runs knowing the business
  // (objectives, ICP, voice, constraints). Empty string when none is set up yet —
  // behavior is unchanged until the owner generates a playbook. Best-effort.
  try {
    const { companyContextBlock } = await import('./company-playbook');
    const ctx = await companyContextBlock();
    if (ctx) combined = `${ctx}\n${combined}`;
  } catch { /* never block a run on context load */ }
  return combined;
}

async function logA2A(from: string, to: string, content: string, metadata: Record<string, unknown> = {}) {
  const conversationId = `mc:a2a:${from}:${to}`;
  await sql()`
    INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type, metadata)
    VALUES (
      ${tenantId()}, ${conversationId}, ${from}, ${to}, ${content}, 'text',
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
  /** True when this spawn was HELD by the per-tenant daily token budget (not a
   *  normal failure). Callers that can pause/resume (e.g. waves) should treat a
   *  blocked result as 'paused', not 'error'. See usage-cap.ts. */
  blocked?: boolean;
}

interface BoardroomRow { direction: 'in' | 'out'; sender: string; text: string; created_at: Date }
interface TaskHistoryRow { agent_id: string; status: string; task: string; result: string | null; started_at: Date }

function fmtTs(ts: Date): string { return new Date(ts).toISOString().replace('T', ' ').replace(/\..+/, ''); }

async function buildMemoryCompactorPayload(originalInstruction: string): Promise<string> {
  const boardroom = (await sql()`
    SELECT direction, sender, text, created_at FROM boardroom_messages
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC LIMIT 50
  `) as unknown as BoardroomRow[];
  const tasks = (await sql()`
    SELECT agent_id, status, task, result, started_at FROM agent_tasks
    WHERE tenant_id = ${tenantId()}
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
      VALUES (${tenantId()}, ${rollupText.trim()})
    `;
  } catch (err) {
    console.error('[memory-compactor] failed to persist rollup:', (err as Error).message);
  }
}

export async function spawnSubAgent(type: string, task: string, parentTaskId?: number, opts?: { variant?: string; maxTurns?: number; model?: string; tools?: 'all' | 'none' }): Promise<SpawnResult> {
  // Audience gate: hq-only agents cannot be spawned by non-HQ tenants.
  // Checked FIRST — before any DB call — so the error is deterministic even
  // when the agent id is not in SUBAGENT_REGISTRY (e.g. fixer / improver, which
  // live in the static roster but not the spawn registry).
  // Import lazily to avoid a circular-dependency at module load time
  // (squad.ts imports SUBAGENT_REGISTRY from here; we only need isAudienceAllowed
  // at call-time, not at import time).
  const { isAudienceAllowed } = await import('./squad');
  if (!isAudienceAllowed(type)) {
    return { ok: false, error: `${type}: this agent is not available in this workspace` };
  }

  // Resolve the spec from the live DB roster (Agent Studio); fall back to the
  // hardcoded registry for builtins that haven't been seeded into the DB.
  const spec = (await getSpawnSpec(type).catch(() => null)) ?? SUBAGENT_REGISTRY[type];
  if (!spec) return { ok: false, error: `Unknown sub-agent type: ${type}. Available: ${Object.keys(SUBAGENT_REGISTRY).join(', ')}` };

  let variant = opts?.variant ?? 'base';

  const rate = checkRate(type);
  if (!rate.allowed) {
    return { ok: false, error: `Rate limit exceeded for ${type} (${spec.ratePerHour}/hr). Resets in ${rate.resetInSec}s.` };
  }

  // Per-tenant daily token budget — THE spawn-boundary gate (see usage-cap.ts).
  // Runs BEFORE any Anthropic call or DB write so nothing in flight is touched;
  // only this NEW spawn is held. Inert unless the tenant opted in AND the global
  // env switch is on, so this is a no-op for everyone by default. We catch the
  // typed BudgetExceededError here and surface it as a BLOCKED result (not a
  // thrown crash and not a normal failure): every existing caller reads res.ok/
  // res.error and will degrade gracefully, while pause-aware callers (waves) can
  // branch on res.blocked to set a resumable 'paused' state instead of 'error'.
  try {
    await assertWithinBudget(spec.maxTokens);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return { ok: false, error: err.message, blocked: true };
    }
    throw err; // unexpected (DB) error — let it propagate, don't silently spend
  }

  // Per-tenant Anthropic key (BYO) — the agent runs on the tenant's own key,
  // falling back to the platform env key for HQ/dev. See anthropic-key.ts.
  const anthropicKey = await getAnthropicKey();
  if (!anthropicKey) return { ok: false, error: 'No Anthropic key — connect one on the Connections page (or set ANTHROPIC_API_KEY).' };

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
  // Goal self-check — prepended so it frames the entire task. The agent must
  // re-state the success criterion verbatim before producing the deliverable.
  // Empty string when the agent doesn't own an active goal; never throws.
  try {
    const { goalDirectiveForAgent } = await import('./goals');
    const selfCheck = await goalDirectiveForAgent(type);
    if (selfCheck) hydratedTask = `${selfCheck}\n\n---\n\n${hydratedTask}`;
  } catch (e) {
    console.error(`[goal self-check] skipped for ${type}:`, (e as Error).message);
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
  // Heartbeat: "I'm starting." Best-effort; emitter swallows errors.
  void heartbeat(type, 'start', task.slice(0, 200), taskId);

  const client = new Anthropic({ apiKey: anthropicKey, maxRetries: 5 });
  const systemPrompt = await loadSubAgentSystemPrompt(type);

  // Tool gate (cost lever). Tools are what make a run multi-turn: each web_search /
  // KG / skill_recall round-trip is a separate billed API call. A caller that only
  // needs a one-shot answer from the inputs it already handed over (e.g. a reel
  // teardown) can pass tools:'none' to run TOOL-FREE — a single turn, no search
  // loop. Default keeps the full toolset so every other agent is unchanged.
  //
  // Google Workspace tools are opt-in: they are added ONLY when the tenant has
  // both connected Google Workspace AND enabled agent actions in Settings.
  // When the gate is false the tools array is byte-identical to before this feature
  // shipped — the model never sees the tools so it can never call them.
  const gwAllowed = opts?.tools !== 'none' && (await googleActionsAllowed());
  const smsOn = opts?.tools !== 'none' && (await smsAllowed());
  const tools: Anthropic.Messages.ToolUnion[] = opts?.tools === 'none' ? [] : [
    { type: 'web_search_20250305', name: 'web_search' },
    // Shared KG tools so every sub-agent can read/write the team's graph.
    ...kgToolDefinitions(),
    // On-demand skill recall — pull a playbook by name mid-run instead of baking
    // every skill into the system prompt at spawn time.
    ...skillRecallToolDefinitions(),
    // Google Workspace tools — only offered when tenant has connected + opted in.
    ...(gwAllowed ? googleToolDefinitions() : []),
    // SMS (Twilio) — offered only when Twilio is connected.
    ...(smsOn ? smsToolDefinitions() : []),
  ];

  // Cache the initial task message. Multi-turn agents (research runs a
  // server-side web_search pause_turn loop, KG/skill tool_use loops) re-send the
  // FULL message array every turn — putting cache_control on the first user block
  // means turns 2+ hit the prompt cache on the stable [system + task] prefix
  // instead of re-billing it. Pure cost win, zero behavior change. The system
  // prompt is already cached (see turn()), so this completes the cached prefix.
  const messages: Anthropic.MessageParam[] = [{
    role: 'user',
    content: [{ type: 'text', text: hydratedTask, cache_control: { type: 'ephemeral' } }],
  }];

  // Live transcript: stream text deltas into the task's stream_text buffer so the
  // Tasks page can watch the run fill in. Writes are debounced to ~1/sec.
  let streamBuf = '';
  let lastWrite = 0;
  const onDelta = (t: string) => {
    streamBuf += t;
    const now = Date.now();
    if (now - lastWrite > 900) { lastWrite = now; void setTaskStream(taskId, streamBuf).catch(() => {}); }
  };
  // Per-spawn model override (cost lever): a caller (e.g. a wave routing bulk
  // fan-out work) can run this spawn on a cheaper tier than the registry default.
  // `|| spec.model` (not ??) so an empty/whitespace override falls back rather
  // than reaching the API as an invalid model id. Callers owning a model
  // override should keep it compatible with spec.maxTokens.
  const runModel = opts?.model?.trim() || spec.model;
  const turn = async (): Promise<Anthropic.Message> => {
    const stream = client.messages.stream({
      model: runModel,
      max_tokens: spec.maxTokens,
      system: [{ type: 'text', text: systemPrompt, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
    });
    stream.on('text', onDelta);
    return stream.finalMessage();
  };

  // Goal observer ("teacher") setup. Cache the owned goal once before the loop;
  // if there's no owned goal OR the kill switch is set, the observer is inert.
  // Bounded cost: at most `maxObserverCalls` interventions per run + per-turn
  // dedup so identical advice can't be inserted twice in a row.
  const observerEnabled = process.env.GOAL_OBSERVER !== 'off';
  const ownedGoal = observerEnabled ? await getOwnedGoalForAgent(type).catch(() => null) : null;
  const observerActive = observerEnabled && ownedGoal !== null;
  let observerCalls = 0;
  let lastCorrectionKey = '';
  let pendingCorrection: string | null = null;

  try {
    let response = await turn();

    // Cap the tool-use loop. Each turn may include a (slow) server-side web_search,
    // so fewer turns = faster wall-clock + less chance of blowing the 300s function
    // limit. Callers in a wave pass a tighter cap; default stays generous.
    const maxTurns = Math.max(1, Math.min(opts?.maxTurns ?? 8, 12));
    // Cap teacher interventions per run so a runaway loop can't spike costs.
    const maxObserverCalls = Math.min(maxTurns, 6);
    let safety = 0;
    while (safety++ < maxTurns) {
      // Goal-observer hook — runs AFTER each turn, BEFORE the stop-reason check
      // so we can inject a corrective user message that lands on the NEXT turn.
      // Strictly best-effort: any failure leaves the loop unchanged.
      if (observerActive && ownedGoal && observerCalls < maxObserverCalls) {
        const assistantText = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
        // Skip tool-only turns or very short responses — no signal to score.
        if (assistantText.length >= 40) {
          observerCalls++;
          const verdict = await observeMessage({
            agentId: type,
            goalTitle: ownedGoal.title,
            successCriterion: ownedGoal.success,
            lastAssistantMessage: assistantText,
          });
          if (verdict) {
            void heartbeat(
              type,
              'progress',
              `obs ${verdict.score.toFixed(2)}: ${verdict.correction ?? 'on track'}`.slice(0, 200),
              taskId,
            );
            if (!verdict.on_track && verdict.correction) {
              const key = verdict.correction.slice(0, 80);
              if (key !== lastCorrectionKey) {
                lastCorrectionKey = key;
                console.log(
                  `[observer] ${type} score=${verdict.score.toFixed(2)} correction="${verdict.correction.slice(0, 80)}"`,
                );
                // Queue the correction; it gets pushed onto `messages` after the
                // assistant + tool-result messages for THIS turn are appended,
                // so it lands as next-turn user-message context (and never
                // breaks the assistant↔user message ordering required by the
                // Anthropic API).
                pendingCorrection = verdict.correction;
              }
            }
          }
        }
      }

      if (response.stop_reason === 'end_turn') break;
      if (response.stop_reason === 'refusal' || response.stop_reason === 'max_tokens') break;
      if (response.stop_reason === 'pause_turn') {
        // web_search runs server-side; just continue the paused turn.
        messages.push({ role: 'assistant', content: response.content });
        if (pendingCorrection) {
          messages.push({
            role: 'user',
            content: [
              {
                type: 'text',
                text: `# Goal-observer correction\n${pendingCorrection}\n\nIncorporate this and continue.`,
              },
            ],
          });
          pendingCorrection = null;
        }
        response = await turn();
        continue;
      }
      if (response.stop_reason === 'tool_use') {
        // Sub-agents can use the shared KG tools (kg_query / kg_remember),
        // recall_skill, and (when opted in) Google Workspace tools.
        // Provenance: the sub-agent type id is the source agent.
        const handledToolUses = response.content.filter(
          (b): b is Anthropic.ToolUseBlock =>
            b.type === 'tool_use' && (
              b.name === 'kg_query' ||
              b.name === 'kg_remember' ||
              b.name === 'recall_skill' ||
              (GOOGLE_TOOL_NAMES as readonly string[]).includes(b.name) ||
              (SMS_TOOL_NAMES as readonly string[]).includes(b.name)
            ),
        );
        if (handledToolUses.length === 0) break;

        messages.push({ role: 'assistant', content: response.content });
        const toolResults = await Promise.all(handledToolUses.map((tu) => {
          if (tu.name === 'recall_skill') return handleSkillRecallTool(tu, type);
          if ((GOOGLE_TOOL_NAMES as readonly string[]).includes(tu.name)) return handleGoogleTool(tu, type);
          if ((SMS_TOOL_NAMES as readonly string[]).includes(tu.name)) return handleSmsTool(tu, type);
          return handleKgTool(tu, type);
        }));
        // Merge the correction (if any) into the same user block as the tool
        // results — two adjacent user messages would violate the API's
        // alternating-roles rule.
        const userContent: Array<Anthropic.ToolResultBlockParam | Anthropic.TextBlockParam> = [
          ...toolResults,
        ];
        if (pendingCorrection) {
          userContent.push({
            type: 'text',
            text: `# Goal-observer correction\n${pendingCorrection}\n\nIncorporate this and continue.`,
          });
          pendingCorrection = null;
        }
        messages.push({ role: 'user', content: userContent });
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
      void heartbeat(type, 'errored', `no text (stop_reason: ${response.stop_reason})`, taskId);
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

    // Pulse: if the agent emitted a `## Pulse update` block, persist it onto
    // its own agent_defs row so the next run reads the freshest state. Soft
    // fail — pulse continuity is nice-to-have, never block the result.
    try {
      const { parsePulseUpdate, setAgentPulse } = await import('./agent-defs');
      const nextPulse = parsePulseUpdate(text);
      if (nextPulse) await setAgentPulse(type, nextPulse);
    } catch (e) {
      console.error(`[pulse] persist failed for ${type}:`, (e as Error).message);
    }

    await finishTask(taskId, {
      status: 'done',
      result: text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    });

    // ROI: log the time this agent run saved (preset minutes for its action type).
    // Best-effort + idempotent per task; never blocks the result.
    await logTimeSaving({ actionType: actionTypeForAgent(type), agentId: type, source: 'agent', taskId }).catch(() => {});

    // Heartbeat: "I finished." Final beat closes the live ticker.
    void heartbeat(type, 'finished', text.slice(0, 200), taskId);

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
    void heartbeat(type, 'errored', msg.slice(0, 200), taskId);
    return { ok: false, error: msg };
  }
}
