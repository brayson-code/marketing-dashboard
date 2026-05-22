// Parallel agent waves — Phase 1 of the self-improving Command Center.
// (Design: KB doc "Command Center PARL".) A campaign runs N waves sequentially;
// each wave runs 2-3 sub-agents in PARALLEL on different angles, then a Sonnet
// synthesizer collapses their outputs into ONE synthesis that the next wave
// builds on (pass synthesis, not raw data). We run ONE wave per invocation and
// checkpoint to wave_runs/wave_step_runs, because a full campaign exceeds the
// 300s function cap and the ~5 req/min Anthropic cap. The owner advances
// wave-by-wave, which also controls cost.

import Anthropic from '@anthropic-ai/sdk';
import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';
import { spawnSubAgent } from './subagent';
import { appendKnowledgeSection } from './documents';
import { appendProgress } from './goals';
import { kgPersistDirective, roleFor } from './constraints';

const SYNTH_MODEL = 'claude-sonnet-4-6'; // synthesis is the quality chokepoint (decided)

export interface CampaignBrief {
  objective: string;
  success: string;
  audience?: string;
  constraints?: string;
  risks?: string[];
}

export interface WaveAgentSpec { agentId: string; task: string }
export interface WaveSpec { label: string; agents: WaveAgentSpec[] }

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

function client(): Anthropic {
  return new Anthropic({ maxRetries: 5 });
}

async function llm(system: string, user: string, maxTokens: number): Promise<string> {
  const res = await client().messages.create({
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

function composeAgentTask(brief: CampaignBrief, prior: string | null, agent: WaveAgentSpec): string {
  const parts = [
    `# Campaign objective\n${brief.objective}`,
    `# Definition of success\n${brief.success}`,
  ];
  if (brief.audience) parts.push(`# Audience / context\n${brief.audience}`);
  if (prior) parts.push(`# Synthesis from the previous wave (build on this — do NOT repeat it)\n${prior}`);
  parts.push(`# Your specific assignment\n${agent.task}`);
  // The chosen variant's role constraints are appended centrally by spawnSubAgent.
  // Research agents additionally persist findings to the graph with tier confidence.
  if (roleFor(agent.agentId) === 'research') parts.push(`# ${kgPersistDirective()}`);
  return parts.join('\n\n');
}

async function synthesizeWave(label: string, brief: CampaignBrief, results: AgentResult[]): Promise<string> {
  const ok = results.filter((r) => r.ok && r.text);
  if (ok.length === 0) {
    return `_No agent in wave "${label}" returned usable output._`;
  }
  const body = ok.map((r, i) => `## Agent ${i + 1} — ${r.task}\n${r.text}`).join('\n\n');
  const system =
    'You merge several parallel research agents\' findings for ONE wave into a single, tight, ' +
    'self-contained synthesis that the NEXT wave will build on (it is the ONLY thing passed forward). ' +
    'Deduplicate; preserve source tiers + dates; surface contradictions explicitly; keep the strongest ' +
    'quantified facts. 6-12 bullets max, grouped by sub-theme. No preamble.';
  const user = `Campaign objective: ${brief.objective}\n\nWave: ${label}\n\nAgent outputs:\n\n${body}`;
  try {
    return await llm(system, user, 1500);
  } catch (err) {
    // Degrade gracefully (brief principle #4): keep the raw outputs rather than lose the wave.
    return `_(synthesis failed: ${(err as Error).message}; raw agent outputs below)_\n\n${body}`;
  }
}

async function loadCampaign(id: string): Promise<CampaignRow | null> {
  const rows = (await sql()`
    SELECT id, title, brief, goal_id, waves, status, current_wave, total_waves
    FROM public.wave_runs WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `) as unknown as CampaignRow[];
  return rows[0] ?? null;
}

async function lastSynthesis(campaignId: string, waveIndex: number): Promise<string | null> {
  const rows = (await sql()`
    SELECT synthesis FROM public.wave_step_runs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND wave_run_id = ${campaignId} AND wave_index = ${waveIndex}
    ORDER BY id DESC LIMIT 1
  `) as unknown as Array<{ synthesis: string | null }>;
  return rows[0]?.synthesis ?? null;
}

async function finalize(c: CampaignRow): Promise<void> {
  const stepRows = (await sql()`
    SELECT label, synthesis FROM public.wave_step_runs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND wave_run_id = ${c.id} AND status = 'done'
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
    WHERE id = ${c.id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `;
}

/**
 * Run the next pending wave of a campaign (parallel agents → synthesis →
 * checkpoint), and finalize if it was the last. Designed to run inside one
 * serverless invocation via after(). Returns whether the campaign is complete.
 */
export async function runNextWave(campaignId: string): Promise<{ done: boolean; ranWave?: number; error?: string }> {
  const c = await loadCampaign(campaignId);
  if (!c) return { done: true, error: 'Campaign not found' };
  if (c.status !== 'running') return { done: true };

  const idx = c.current_wave;
  if (idx >= c.waves.length) { await finalize(c); return { done: true }; }

  const wave = c.waves[idx];
  const prior = idx > 0 ? await lastSynthesis(campaignId, idx - 1) : null;

  const stepRows = (await sql()`
    INSERT INTO public.wave_step_runs (tenant_id, wave_run_id, wave_index, label, status)
    VALUES (${DEFAULT_TENANT_ID}, ${campaignId}, ${idx}, ${wave.label}, 'running')
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  const stepId = Number(stepRows[0].id);

  try {
    const results: AgentResult[] = await Promise.all(
      wave.agents.map(async (a) => {
        // spawnSubAgent picks + records the constraint variant; we read it back
        // so outcome scoring can attribute the campaign result per variant.
        const r = await spawnSubAgent(a.agentId, composeAgentTask(c.brief, prior, a));
        return { agentId: a.agentId, task: a.task, ok: r.ok, text: r.text ?? null, error: r.error ?? null, variant: r.variant ?? 'base' };
      }),
    );
    const synthesis = await synthesizeWave(wave.label, c.brief, results);

    await sql()`
      UPDATE public.wave_step_runs
      SET status = 'done', synthesis = ${synthesis}, agent_results = ${jsonb(results)}, finished_at = now()
      WHERE id = ${stepId} AND tenant_id = ${DEFAULT_TENANT_ID}
    `;

    const nextIdx = idx + 1;
    await sql()`
      UPDATE public.wave_runs SET current_wave = ${nextIdx}, updated_at = now()
      WHERE id = ${campaignId} AND tenant_id = ${DEFAULT_TENANT_ID}
    `;

    if (nextIdx >= c.waves.length) {
      await finalize({ ...c, current_wave: nextIdx });
      return { done: true, ranWave: idx };
    }
    return { done: false, ranWave: idx };
  } catch (err) {
    const msg = (err as Error).message;
    await sql()`
      UPDATE public.wave_step_runs SET status = 'error', finished_at = now()
      WHERE id = ${stepId} AND tenant_id = ${DEFAULT_TENANT_ID}
    `.catch(() => {});
    await sql()`
      UPDATE public.wave_runs SET status = 'error', error = ${msg}, updated_at = now()
      WHERE id = ${campaignId} AND tenant_id = ${DEFAULT_TENANT_ID}
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
}

export async function createCampaign(input: CreateCampaignInput): Promise<string> {
  const rows = (await sql()`
    INSERT INTO public.wave_runs (tenant_id, title, request, brief, goal_id, waves, status, current_wave, total_waves)
    VALUES (
      ${DEFAULT_TENANT_ID}, ${input.title}, ${input.request ?? null}, ${jsonb(input.brief)},
      ${input.goalId ?? null}, ${jsonb(input.waves)}, 'running', 0, ${input.waves.length}
    )
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows[0].id;
}

export interface CampaignListItem {
  id: string;
  title: string;
  status: string;
  current_wave: number;
  total_waves: number;
  goal_id: string | null;
  updated_at: string;
}

export async function listCampaigns(): Promise<CampaignListItem[]> {
  const rows = (await sql()`
    SELECT id, title, status, current_wave, total_waves, goal_id, updated_at
    FROM public.wave_runs WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY updated_at DESC LIMIT 50
  `) as unknown as Array<Omit<CampaignListItem, 'updated_at'> & { updated_at: Date }>;
  return rows.map((r) => ({ ...r, updated_at: new Date(r.updated_at).toISOString() }));
}

export interface CampaignStep {
  wave_index: number;
  label: string | null;
  status: string;
  synthesis: string | null;
  agent_results: AgentResult[] | null;
  started_at: string;
  finished_at: string | null;
}

export async function getCampaignDetail(id: string): Promise<{ campaign: Record<string, unknown>; steps: CampaignStep[] } | null> {
  const rows = (await sql()`
    SELECT id, title, request, brief, goal_id, waves, status, current_wave, total_waves, final_report, error, created_at, updated_at
    FROM public.wave_runs WHERE id = ${id} AND tenant_id = ${DEFAULT_TENANT_ID}
  `) as unknown as Array<Record<string, unknown>>;
  if (rows.length === 0) return null;
  const stepRows = (await sql()`
    SELECT wave_index, label, status, synthesis, agent_results, started_at, finished_at
    FROM public.wave_step_runs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND wave_run_id = ${id}
    ORDER BY wave_index ASC, id ASC
  `) as unknown as Array<{ wave_index: number; label: string | null; status: string; synthesis: string | null; agent_results: AgentResult[] | null; started_at: Date; finished_at: Date | null }>;
  const steps: CampaignStep[] = stepRows.map((s) => ({
    wave_index: s.wave_index,
    label: s.label,
    status: s.status,
    synthesis: s.synthesis,
    agent_results: s.agent_results,
    started_at: new Date(s.started_at).toISOString(),
    finished_at: s.finished_at ? new Date(s.finished_at).toISOString() : null,
  }));
  return { campaign: rows[0], steps };
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
