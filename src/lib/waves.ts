// Parallel agent waves — Phase 1 of the self-improving Command Center.
// (Design: KB doc "Command Center PARL".) A campaign runs N waves sequentially;
// each wave runs 2-3 sub-agents in PARALLEL on different angles, then a Sonnet
// synthesizer collapses their outputs into ONE synthesis that the next wave
// builds on (pass synthesis, not raw data). We run ONE wave per invocation and
// checkpoint to wave_runs/wave_step_runs, because a full campaign exceeds the
// 300s function cap and the ~5 req/min Anthropic cap. The owner advances
// wave-by-wave, which also controls cost.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { sql, jsonb, tenantId } from './db/client';
import { spawnSubAgent } from './subagent';
import { appendKnowledgeSection } from './documents';
import { appendProgress } from './goals';
import { kgPersistDirective, roleFor } from './constraints';
import { observeWaveBoundary } from './wave-observer';
import { verifyWaveFindings, verificationToMarkdown, type WaveVerification } from './wave-verify';
import { heartbeat } from './heartbeat';
import { assertWithinBudget, BudgetExceededError } from './usage-cap';

const SYNTH_MODEL = 'claude-sonnet-4-6'; // synthesis is the quality chokepoint (decided)

export interface CampaignBrief {
  objective: string;
  success: string;
  audience?: string;
  constraints?: string;
  risks?: string[];
}

export interface WaveAgentSpec { agentId: string; task: string }
/** WaveSpec.brief is an optional wave-level prepend, used by the wave-boundary
 *  observer to inject a course-correct hint into the NEXT wave before it runs.
 *  When present, it's prepended to every agent's composed task in that wave. */
export interface WaveSpec { label: string; agents: WaveAgentSpec[]; brief?: string }

export interface AgentResult { agentId: string; task: string; ok: boolean; text: string | null; error: string | null; variant?: string }

interface CampaignRow {
  id: string;
  title: string;
  brief: CampaignBrief;
  goal_id: string | null;
  waves: WaveSpec[];
  status: string;
  current_wave: number;
  total_waves: number;
}

async function llm(system: string, user: string, maxTokens: number): Promise<string> {
  // Spawn-boundary gate for the DIRECT anthropic path (wave synthesis + finalize
  // report). spawnSubAgent gates per-agent work itself; this is the SECOND spend
  // path that bypasses it, so it must be gated too or the cap leaks. Throws
  // BudgetExceededError when an opted-in tenant is over budget; runNextWave
  // catches it and pauses (resumable) rather than erroring.
  await assertWithinBudget(maxTokens);
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(NO_ANTHROPIC_KEY_MESSAGE);
  const client = new Anthropic({ apiKey, maxRetries: 5 });
  const res = await client.messages.create({
    model: SYNTH_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

function composeAgentTask(
  brief: CampaignBrief,
  prior: string | null,
  agent: WaveAgentSpec,
  wavePrepend?: string,
): string {
  const parts: string[] = [];
  // Wave-level prepend (e.g. wave-observer course-correct hint) goes FIRST so
  // the model treats it as the operating instruction for this wave.
  if (wavePrepend && wavePrepend.trim().length > 0) parts.push(wavePrepend.trim());
  parts.push(`# Campaign objective\n${brief.objective}`);
  parts.push(`# Definition of success\n${brief.success}`);
  if (brief.audience) parts.push(`# Audience / context\n${brief.audience}`);
  if (prior) parts.push(`# Synthesis from the previous wave (build on this — do NOT repeat it)\n${prior}`);
  parts.push(`# Your specific assignment\n${agent.task}`);
  // The chosen variant's role constraints are appended centrally by spawnSubAgent.
  // Research agents additionally persist findings to the graph with tier confidence.
  if (roleFor(agent.agentId) === 'research') parts.push(`# ${kgPersistDirective()}`);
  return parts.join('\n\n');
}

async function synthesizeWave(
  label: string,
  brief: CampaignBrief,
  results: AgentResult[],
  verification?: WaveVerification | null,
): Promise<string> {
  const ok = results.filter((r) => r.ok && r.text);
  if (ok.length === 0) {
    return `_No agent in wave "${label}" returned usable output._`;
  }
  const body = ok.map((r, i) => `## Agent ${i + 1} — ${r.task}\n${r.text}`).join('\n\n');
  // Feed the skeptic's flags into the synthesis prompt so the merge can caveat
  // (or down-weight) the shaky claims rather than laundering them into clean prose.
  const flagBlock = verification && verification.flagged.length > 0
    ? `\n\nA fact-checker flagged these claims as shaky — caveat or drop them, do not present them as solid:\n` +
      verification.flagged.map((f) => `- (${f.reason}) ${f.claim}`).join('\n')
    : '';
  const system =
    'You merge several parallel research agents\' findings for ONE wave into a single, tight, ' +
    'self-contained synthesis that the NEXT wave will build on (it is the ONLY thing passed forward). ' +
    'Deduplicate; preserve source tiers + dates; surface contradictions explicitly; keep the strongest ' +
    'quantified facts. Respect the fact-checker\'s flags. 6-12 bullets max, grouped by sub-theme. No preamble.';
  const user = `Campaign objective: ${brief.objective}\n\nWave: ${label}\n\nAgent outputs:\n\n${body}${flagBlock}`;
  let synthesis: string;
  try {
    synthesis = await llm(system, user, 1500);
  } catch (err) {
    // A budget block is NOT a synthesis failure to paper over — rethrow it so
    // runNextWave can pause this wave (resumable) instead of persisting a
    // degraded synthesis and advancing past it.
    if (err instanceof BudgetExceededError) throw err;
    // Otherwise degrade gracefully (brief principle #4): keep the raw outputs
    // rather than lose the wave.
    synthesis = `_(synthesis failed: ${(err as Error).message}; raw agent outputs below)_\n\n${body}`;
  }
  // Append the reliability block so it persists into the wave synthesis and
  // flows into the final report's confidence section via finalize().
  return synthesis + verificationToMarkdown(verification ?? null);
}

async function loadCampaign(id: string): Promise<CampaignRow | null> {
  const rows = (await sql()`
    SELECT id, title, brief, goal_id, waves, status, current_wave, total_waves
    FROM public.wave_runs WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as CampaignRow[];
  return rows[0] ?? null;
}

async function lastSynthesis(campaignId: string, waveIndex: number): Promise<string | null> {
  const rows = (await sql()`
    SELECT synthesis FROM public.wave_step_runs
    WHERE tenant_id = ${tenantId()} AND wave_run_id = ${campaignId} AND wave_index = ${waveIndex}
    ORDER BY id DESC LIMIT 1
  `) as unknown as Array<{ synthesis: string | null }>;
  return rows[0]?.synthesis ?? null;
}

async function finalize(c: CampaignRow): Promise<void> {
  const stepRows = (await sql()`
    SELECT label, synthesis FROM public.wave_step_runs
    WHERE tenant_id = ${tenantId()} AND wave_run_id = ${c.id} AND status = 'done'
    ORDER BY wave_index ASC
  `) as unknown as Array<{ label: string | null; synthesis: string | null }>;

  const combined = stepRows.map((s) => `## ${s.label}\n${s.synthesis ?? ''}`).join('\n\n');
  let report = combined;
  try {
    const system =
      'You compile the per-wave syntheses of a research campaign into ONE decision-ready report for a ' +
      'marketing operator. Structure: a 4-6 bullet executive summary first, then the key findings grouped ' +
      'by theme, then concrete recommended next moves, then a short "confidence + gaps" note. ' +
      'Preserve source tiers + dates. No fluff.';
    const user = `Objective: ${c.brief.objective}\n\nDefinition of success: ${c.brief.success}\n\nWave syntheses:\n\n${combined}`;
    report = await llm(system, user, 2500);
  } catch {
    // keep the combined syntheses as the report on failure
  }

  await appendKnowledgeSection(`${c.title} — research report`, new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC', report)
    .catch((e) => console.error('[waves] KB save failed:', (e as Error).message));

  if (c.goal_id) {
    await appendProgress(c.goal_id, `Research campaign "${c.title}" completed all ${c.total_waves} waves. Report filed to the knowledge base.`)
      .catch((e) => console.error('[waves] goal progress failed:', (e as Error).message));
  }

  await sql()`
    UPDATE public.wave_runs
    SET status = 'done', final_report = ${report}, current_wave = ${c.total_waves}, updated_at = now()
    WHERE id = ${c.id} AND tenant_id = ${tenantId()}
  `;
}

/** Cap on the synthesis text we send into the observer prompt — a runaway wave
 *  must NOT blow the observer's prompt budget. */
const OBSERVER_SYNTHESIS_CAP = 4000;

/**
 * Wave-boundary observer dispatch. Loads the goal, calls the observer, and if
 * drift is high mutates the NEXT wave's brief in wave_runs.waves so the next
 * invocation reads the corrected plan. Best-effort only — never throws.
 *
 * Why fetch-modify-update instead of jsonb_set: the path we'd need to target is
 * `{waves,<nextIdx>,brief}`, which (a) requires interpolating an integer key
 * into the jsonb path and (b) needs `create_missing := true`. A read-then-write
 * is simpler, atomic enough for a per-mission single-writer, and keeps the
 * cached `c.waves` we already have in memory in sync.
 */
async function maybeCourseCorrect(opts: {
  campaignId: string;
  goalId: string;
  waveLabel: string;
  synthesis: string;
  nextIdx: number;
  waves: WaveSpec[];
}): Promise<void> {
  // Look up the goal's title + verbatim success criterion (one SELECT).
  const goalRows = (await sql()`
    SELECT title, success FROM public.goals
    WHERE id = ${opts.goalId} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as Array<{ title: string; success: string }>;
  const g = goalRows[0];
  if (!g) return; // goal vanished — silently skip

  const synthesisCapped =
    opts.synthesis.length > OBSERVER_SYNTHESIS_CAP
      ? opts.synthesis.slice(0, OBSERVER_SYNTHESIS_CAP)
      : opts.synthesis;
  const remainingLabels = opts.waves.slice(opts.nextIdx).map((w) => w.label);

  const drift = await observeWaveBoundary({
    waveLabel: opts.waveLabel,
    waveSynthesis: synthesisCapped,
    goalTitle: g.title,
    successCriterion: g.success,
    remainingWaveLabels: remainingLabels,
  });
  if (!drift) return; // observer errored / unparseable — already logged

  const hint = drift.corrective_hint?.trim();
  if (drift.on_track || !hint) return; // on-track or empty hint — nothing to do

  // Mutate the NEXT wave's brief field in the wave_runs.waves jsonb.
  // Fetch-modify-update: read the current waves, patch index nextIdx, write back.
  const cur = (await sql()`
    SELECT waves FROM public.wave_runs
    WHERE id = ${opts.campaignId} AND tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as Array<{ waves: WaveSpec[] }>;
  const wavesNow = cur[0]?.waves;
  if (!Array.isArray(wavesNow) || !wavesNow[opts.nextIdx]) return;

  const nextWave = wavesNow[opts.nextIdx];
  const correctiveBlock = `# Mission course-correct\n${hint}\n\n---\n`;
  const existingBrief = typeof nextWave.brief === 'string' ? nextWave.brief : '';
  nextWave.brief = `${correctiveBlock}${existingBrief}`;

  await sql()`
    UPDATE public.wave_runs SET waves = ${jsonb(wavesNow)}, updated_at = now()
    WHERE id = ${opts.campaignId} AND tenant_id = ${tenantId()}
  `;

  // TODO(observer-persistence): when `wave_step_runs.observer_drift jsonb`
  // exists, also persist { drift_score, corrective_hint } onto the just-
  // finished step row. Skipped today — column doesn't exist and we're not
  // shipping a migration alongside this change.

  const beat = `wave-observer drift=${drift.drift_score.toFixed(2)}: ${hint}`.slice(0, 200);
  await heartbeat('keyplayer', 'progress', beat, null).catch(() => {});

  console.log(
    `[wave-observer] mission=${opts.campaignId} wave=${opts.waveLabel} ` +
      `drift=${drift.drift_score.toFixed(2)} hint="${hint.slice(0, 80)}"`,
  );
}

/**
 * Pause a mission on a daily-token-budget block. RESUMABLE, not terminal:
 *  - the in-progress step row is marked 'paused' (not 'error'),
 *  - the mission row is set status='paused' with a clear reason in `error`,
 *  - current_wave is NOT advanced, so re-running advance after the cap resets
 *    (next UTC day) or is raised continues from THIS wave.
 * Note: status is plain text on wave_runs/wave_step_runs (no CHECK constraint —
 * see migration 0011), so 'paused' needs no schema change.
 */
async function pauseWave(opts: { campaignId: string; stepId: number; reason: string }): Promise<void> {
  await sql()`
    UPDATE public.wave_step_runs SET status = 'paused', finished_at = now()
    WHERE id = ${opts.stepId} AND tenant_id = ${tenantId()}
  `.catch(() => {});
  await sql()`
    UPDATE public.wave_runs SET status = 'paused', error = ${opts.reason}, updated_at = now()
    WHERE id = ${opts.campaignId} AND tenant_id = ${tenantId()}
  `.catch(() => {});
  await heartbeat('keyplayer', 'progress', `mission paused: ${opts.reason}`.slice(0, 200), null).catch(() => {});
}

/**
 * Run the next pending wave of a campaign (parallel agents → synthesis →
 * checkpoint), and finalize if it was the last. Designed to run inside one
 * serverless invocation via after(). Returns whether the campaign is complete.
 */
export async function runNextWave(campaignId: string): Promise<{ done: boolean; ranWave?: number; error?: string; paused?: boolean }> {
  const c = await loadCampaign(campaignId);
  if (!c) return { done: true, error: 'Campaign not found' };
  if (c.status !== 'running') return { done: true };

  const idx = c.current_wave;
  if (idx >= c.waves.length) { await finalize(c); return { done: true }; }

  const wave = c.waves[idx];
  const prior = idx > 0 ? await lastSynthesis(campaignId, idx - 1) : null;

  const stepRows = (await sql()`
    INSERT INTO public.wave_step_runs (tenant_id, wave_run_id, wave_index, label, status)
    VALUES (${tenantId()}, ${campaignId}, ${idx}, ${wave.label}, 'running')
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  const stepId = Number(stepRows[0].id);

  try {
    // Daily-token-budget gate — checked ONCE at the wave boundary, BEFORE any
    // agent in this wave spawns. Over budget → pause the wave having spent
    // nothing, so re-running advance (after the cap resets or is raised) re-runs
    // this wave clean with zero double-billing. A wave is atomic: once we're
    // under budget here we commit to its 2–3 bounded agents and never pause
    // mid-wave (which would re-bill the agents that already finished, on resume).
    try {
      await assertWithinBudget();
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        const reason = 'Daily token budget reached — mission paused (resumable).';
        await pauseWave({ campaignId, stepId, reason });
        return { done: true, paused: true, ranWave: idx, error: reason };
      }
      throw err;
    }

    const spawns = await Promise.all(
      wave.agents.map(async (a) => {
        // spawnSubAgent picks + records the constraint variant; we read it back
        // so outcome scoring can attribute the campaign result per variant.
        const r = await spawnSubAgent(a.agentId, composeAgentTask(c.brief, prior, a, wave.brief), undefined, { maxTurns: 6 });
        return { a, r };
      }),
    );
    // A per-agent budget block mid-wave (rare — only if a concurrent mission
    // crossed the cap after this wave passed its boundary check) flows through
    // as a failed agent (ok:false), and synthesis proceeds with whoever
    // succeeded. We do NOT pause-and-rerun here: that would re-bill the agents
    // already done. The NEXT wave's boundary check pauses cleanly if still over.
    const results: AgentResult[] = spawns.map(({ a, r }) => ({
      agentId: a.agentId, task: a.task, ok: r.ok, text: r.text ?? null, error: r.error ?? null, variant: r.variant ?? 'base',
    }));
    // --- Bounded skeptic verification --------------------------------------
    // Before synthesis: ONE cheap Haiku pass flags unverifiable/single-source/
    // undated/overstated claims so the merge can caveat them and the owner sees
    // the wave's reliability. Off via WAVE_VERIFY=off. Best-effort → null.
    let verification: WaveVerification | null = null;
    if (process.env.WAVE_VERIFY !== 'off') {
      const combined = results.filter((r) => r.ok && r.text).map((r) => r.text).join('\n\n');
      verification = await verifyWaveFindings({
        objective: c.brief.objective,
        successCriterion: c.brief.success,
        combinedFindings: combined,
      }).catch(() => null);
      if (verification) {
        void heartbeat('keyplayer', 'progress',
          `wave-verify ${verification.overall_confidence}: ${verification.flagged.length} flagged`.slice(0, 200), null);
      }
    }
    // -----------------------------------------------------------------------

    const synthesis = await synthesizeWave(wave.label, c.brief, results, verification);

    await sql()`
      UPDATE public.wave_step_runs
      SET status = 'done', synthesis = ${synthesis}, agent_results = ${jsonb(results)}, finished_at = now()
      WHERE id = ${stepId} AND tenant_id = ${tenantId()}
    `;

    const nextIdx = idx + 1;

    // --- Wave-boundary observer ---------------------------------------------
    // Between waves: check the just-finished synthesis against the mission's
    // goal success criterion. If we've drifted, mutate the NEXT wave's brief
    // with a corrective hint BEFORE it kicks off. Best-effort: any failure
    // must NOT block wave chaining.
    if (
      process.env.WAVE_OBSERVER !== 'off' &&
      c.goal_id &&
      nextIdx < c.waves.length // cost guard: no point checking after the LAST wave
    ) {
      await maybeCourseCorrect({
        campaignId,
        goalId: c.goal_id,
        waveLabel: wave.label,
        synthesis,
        nextIdx,
        waves: c.waves,
      }).catch((e) => console.error('[wave-observer] dispatch failed:', (e as Error).message));
    }
    // -----------------------------------------------------------------------

    await sql()`
      UPDATE public.wave_runs SET current_wave = ${nextIdx}, updated_at = now()
      WHERE id = ${campaignId} AND tenant_id = ${tenantId()}
    `;

    if (nextIdx >= c.waves.length) {
      await finalize({ ...c, current_wave: nextIdx });
      return { done: true, ranWave: idx };
    }
    return { done: false, ranWave: idx };
  } catch (err) {
    const msg = (err as Error).message;
    // A budget block reaching here (from the synthesis llm() path) PAUSES the
    // mission — resumable, not a terminal 'error'. current_wave is untouched so
    // re-running advance re-runs this wave once the cap resets or is raised.
    if (err instanceof BudgetExceededError) {
      await pauseWave({ campaignId, stepId, reason: msg });
      return { done: true, paused: true, ranWave: idx, error: msg };
    }
    await sql()`
      UPDATE public.wave_step_runs SET status = 'error', finished_at = now()
      WHERE id = ${stepId} AND tenant_id = ${tenantId()}
    `.catch(() => {});
    await sql()`
      UPDATE public.wave_runs SET status = 'error', error = ${msg}, updated_at = now()
      WHERE id = ${campaignId} AND tenant_id = ${tenantId()}
    `;
    return { done: true, error: msg };
  }
}

export interface CreateCampaignInput {
  title: string;
  request?: string;
  brief: CampaignBrief;
  waves: WaveSpec[];
  goalId?: string | null;
  /** When this mission was launched from inside a Campaign container, set the
   *  parent's id so the Campaign detail view can roll up its missions. Null /
   *  omitted = standalone mission (the default). */
  campaignId?: string | null;
}

export async function createCampaign(input: CreateCampaignInput): Promise<string> {
  const rows = (await sql()`
    INSERT INTO public.wave_runs (tenant_id, title, request, brief, goal_id, campaign_id, waves, status, current_wave, total_waves)
    VALUES (
      ${tenantId()}, ${input.title}, ${input.request ?? null}, ${jsonb(input.brief)},
      ${input.goalId ?? null}, ${input.campaignId ?? null}, ${jsonb(input.waves)},
      'running', 0, ${input.waves.length}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

export interface MissionListItem {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  goal_id: string | null;
  campaign_id: string | null;
  updated_at: string;
  /** Wave specs — { label, agents[] } per wave. Included so the Overview's
   *  Missions strip can render the real pipeline without a second fetch. The
   *  jsonb is small (typically 4 waves × a handful of agents). */
  waves: WaveSpec[];
}

export async function listMissions(): Promise<MissionListItem[]> {
  const rows = (await sql()`
    SELECT id, title, status, current_wave, total_waves, goal_id, campaign_id, waves, updated_at
    FROM public.wave_runs WHERE tenant_id = ${tenantId()}
    ORDER BY updated_at DESC LIMIT 50
  `) as unknown as Array<Omit<MissionListItem, 'updated_at' | 'waves'> & { updated_at: Date; waves: WaveSpec[] | null }>;
  return rows.map((r) => ({ ...r, waves: r.waves ?? [], updated_at: new Date(r.updated_at).toISOString() }));
}

export interface MissionStep {
  wave_index: number;
  label: string | null;
  status: string;
  synthesis: string | null;
  agent_results: AgentResult[] | null;
  started_at: string;
  finished_at: string | null;
}

export async function getMissionDetail(id: string): Promise<{ mission: Record<string, unknown>; steps: MissionStep[] } | null> {
  const rows = (await sql()`
    SELECT id, title, request, brief, goal_id, campaign_id, waves, status, current_wave, total_waves, final_report, error, created_at, updated_at
    FROM public.wave_runs WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const stepRows = (await sql()`
    SELECT wave_index, label, status, synthesis, agent_results, started_at, finished_at
    FROM public.wave_step_runs
    WHERE tenant_id = ${tenantId()} AND wave_run_id = ${id}
    ORDER BY wave_index ASC, id ASC
  `) as unknown as Array<{ wave_index: number; label: string | null; status: string; synthesis: string | null; agent_results: AgentResult[] | null; started_at: Date; finished_at: Date | null }>;
  const steps: MissionStep[] = stepRows.map((s) => ({
    wave_index: s.wave_index,
    label: s.label,
    status: s.status,
    synthesis: s.synthesis,
    agent_results: s.agent_results,
    started_at: new Date(s.started_at).toISOString(),
    finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null,
  }));
  return { mission: rows[0], steps };
}

/**
 * A composed wave plan, structurally typed here so waves.ts can build a campaign
 * from ANY objective without importing campaign-planner (which imports waves —
 * keeping the dependency one-way and cycle-free). campaign-planner.ts owns the
 * canonical PlannedWave/WavePlan + the planner; this is the minimal shape the
 * builder consumes.
 */
export interface PlannedWaveLike {
  title: string;
  goal: string;
  agent_ids: string[];
  prompt_directives: string;
}
export interface WavePlanLike {
  objective_type: string;
  waves: PlannedWaveLike[];
  final_deliverable: string;
}

/**
 * Build the executable WaveSpec[] (what runNextWave runs) from a composed plan
 * and the live brief. This is the GENERAL campaign builder — the wave execution,
 * synthesis, finalize and reward paths downstream are objective-agnostic and
 * unchanged. For the research objective we re-render through buildResearchCampaign
 * so the agent task text carries the real objective verbatim (today's behavior);
 * for every other objective, each wave's per-agent task is its goal + objective,
 * and the wave-level directives ride along as WaveSpec.brief (prepended to every
 * agent in that wave, exactly like the wave-observer course-correct hint).
 */
export function buildCampaignFromPlan(plan: WavePlanLike, brief: CampaignBrief): WaveSpec[] {
  if (plan.objective_type === 'research') return buildResearchCampaign(brief);
  return plan.waves.map((w) => ({
    label: w.title,
    brief: w.prompt_directives,
    agents: w.agent_ids.map((agentId) => ({
      agentId,
      task: `${w.goal}\n\nObjective: ${brief.objective}\nDefinition of success: ${brief.success}`,
    })),
  }));
}

/** The default 4-wave market-research campaign from the owner's brief. */
export function buildResearchCampaign(brief: CampaignBrief): WaveSpec[] {
  const o = brief.objective;
  return [
    {
      label: 'Wave 1: Market Landscape',
      agents: [
        { agentId: 'research-analyst', task: `Size the market for: ${o}. TAM/SAM/SOM with figures, growth rate, and how it's segmented.` },
        { agentId: 'research-analyst', task: `Identify the major trends and shifts shaping: ${o}. What's accelerating, what's fading, and why.` },
        { agentId: 'research-analyst', task: `Scan the regulatory / compliance / platform-policy landscape relevant to: ${o}.` },
      ],
    },
    {
      label: 'Wave 2: Competitive Analysis',
      agents: [
        { agentId: 'research-analyst', task: `Deep-dive the top competitors for: ${o}. Positioning, pricing, strengths/weaknesses.` },
        { agentId: 'research-analyst', task: `Map substitutes and indirect alternatives for: ${o}. How buyers solve this today without us.` },
        { agentId: 'research-analyst', task: `Analyze competitors' go-to-market for: ${o}. Channels, messaging, motions that work.` },
      ],
    },
    {
      label: 'Wave 3: Customer & Demand',
      agents: [
        { agentId: 'research-analyst', task: `Mine Reddit/forums/communities for unfiltered customer pain, language, and objections around: ${o}.` },
        { agentId: 'research-analyst', task: `Quantify demand signals for: ${o} — search trends, hiring, funding, launches.` },
        { agentId: 'research-analyst', task: `Profile the target audience for: ${o}. Segments, jobs-to-be-done, where they pay attention.` },
      ],
    },
    {
      label: 'Wave 4: Distribution',
      agents: [
        { agentId: 'research-analyst', task: `Rank the most effective distribution channels for: ${o}, with rationale and expected CAC dynamics.` },
        { agentId: 'research-analyst', task: `Recommend a geographic / segment entry strategy for: ${o} — where to start and why.` },
      ],
    },
  ];
}

// Where the app lives, for self-invocation (auto-advance chains wave→wave by
// re-triggering itself in a fresh function so each wave gets a clean 300s budget).
function appBaseUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://command.keyplayershq.com';
}

/**
 * Fire-and-forget the next wave in a SEPARATE serverless invocation. This is how
 * a campaign auto-advances end-to-end without manual clicks: each finished wave
 * kicks the next one, and because every wave runs in its own function it keeps a
 * full 300s budget (no single mega-run to time out). Secret-gated via CRON_SECRET.
 *
 * CRITICAL: the self-call carries the ACTIVE tenant_id in the body. /api/cron/advance
 * runs with no Supabase session (it's a server-to-server CRON_SECRET call), so without
 * this the advance handler would fall back to the HQ default tenant, loadCampaign's
 * `tenant_id = tenantId()` filter would miss the real-tenant mission, and the chain
 * would silently stop at the wave boundary (the bug that stalled every client mission).
 * Also used by the onboarding quick-mission kickoff so wave 0 runs in its own function
 * instead of as a detached promise that Fluid Compute freezes.
 */
export function dispatchMissionAdvance(campaignId: string, tenant: string = tenantId()): void {
  const secret = process.env.CRON_SECRET?.trim();
  const url = `${appBaseUrl()}/api/cron/advance`;
  void fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
    body: JSON.stringify({ id: campaignId, tenant_id: tenant }),
  }).catch((e) => console.error('[waves] dispatchMissionAdvance failed:', (e as Error).message));
}

/**
 * Run one wave, then auto-chain the next until the campaign is done or errors.
 * Used by launch + the /api/cron/advance self-trigger. The manual "Advance" button
 * still works as an override but is no longer required.
 */
export async function runAndChain(campaignId: string): Promise<{ done: boolean; ranWave?: number; error?: string }> {
  const r = await runNextWave(campaignId);
  if (!r.done && !r.error) dispatchMissionAdvance(campaignId); // more waves remain → keep going (carries tenant)
  return r;
}

/**
 * Cross-tenant janitor for stalled missions. A mission whose wave chain dies
 * (orphaned background run, or a pre-fix boundary stall) sits in status='running'
 * forever — misleading the UI and the first_mission milestone. This runs from the
 * hourly cron dispatcher with NO tenant context, so it scopes every action to the
 * row's own tenant_id:
 *   - stale 10min–2h, not yet at the last wave → re-dispatch the next wave (tenant-aware)
 *   - stale > 2h → terminalize to status='error' so it stops reading as in-flight
 * The 10-minute staleness gate makes a double-run unlikely (a live wave updates
 * updated_at well within that window).
 */
export async function sweepStuckMissions(): Promise<{ rekicked: number; failed: number }> {
  const stale = (await sql()`
    SELECT id, tenant_id, current_wave, total_waves, updated_at
    FROM public.wave_runs
    WHERE status = 'running' AND updated_at < now() - interval '10 minutes'
    ORDER BY updated_at ASC
    LIMIT 50
  `) as unknown as Array<{ id: string; tenant_id: string; current_wave: number; total_waves: number; updated_at: Date }>;

  const HARD_CUTOFF_MS = 2 * 60 * 60 * 1000; // 2h with no progress → give up
  let rekicked = 0;
  let failed = 0;
  for (const m of stale) {
    const ageMs = Date.now() - new Date(m.updated_at).getTime();
    if (ageMs > HARD_CUTOFF_MS) {
      await sql()`
        UPDATE public.wave_runs
        SET status = 'error',
            error = 'Mission stalled — no wave progress for over 2 hours (auto-failed by the recovery sweep).',
            updated_at = now()
        WHERE id = ${m.id} AND tenant_id = ${m.tenant_id} AND status = 'running'
      `.catch(() => {});
      failed++;
      continue;
    }
    dispatchMissionAdvance(m.id, m.tenant_id);
    rekicked++;
  }
  return { rekicked, failed };
}
