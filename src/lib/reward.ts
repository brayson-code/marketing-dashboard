// Phase 3 (measurement loop) of the self-improving Command Center
// (design: KB "Command Center PARL"). Scores completed agent runs with the
// owner-weighted blend and accumulates per-(role, agent) reward stats in
// agent_policy. This MEASURES only — it does not yet change which agent gets
// spawned (selection is the next slice), so it can't misbehave.
//
// Reward = (w_a·Approval + w_o·Outcome + w_r·Reliability) / sum-of-PRESENT-weights.
// Sparsity is handled by dividing over the components actually available, so a
// good run isn't punished for a signal that hasn't arrived yet.
//
// Attribution today (honest): Reliability is per-task (agent_tasks.status);
// Approval is per-agent (agent_drafts approved/rejected by created_by);
// Outcome is not yet attributable per task → null for now. The staged curriculum
// (Kimi-style spawn→success) is implemented as a weight schedule keyed on the
// agent's maturity (cold→warm), ready for Outcome to plug in.

import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';
import { roleFor } from './constraints';

export interface RewardWeights { approval: number; outcome: number; reliability: number }

// Base owner weights (decided: 0.5 / 0.3 / 0.2). Cold start leans on the dense
// process/reliability signal (Kimi-style: reward the act of doing it well first),
// then warms toward the true outcome signal as the agent accumulates history.
const BASE_WEIGHTS: RewardWeights = { approval: 0.5, outcome: 0.3, reliability: 0.2 };
const COLD_WEIGHTS: RewardWeights = { approval: 0.4, outcome: 0.1, reliability: 0.5 };
const WARM_THRESHOLD = 20; // runs before an agent is considered "warm"

// TODO(weights-ui): read owner-tuned weights from a settings row when the slider lands.
function stageWeights(stage: 'cold' | 'warm'): RewardWeights {
  return stage === 'cold' ? COLD_WEIGHTS : BASE_WEIGHTS;
}

type Component = number | null;

/** Blend present components only; returns 0..1, or null if nothing present. */
function blend(c: { approval: Component; outcome: Component; reliability: Component }, w: RewardWeights): number | null {
  let num = 0;
  let den = 0;
  if (c.approval != null) { num += w.approval * c.approval; den += w.approval; }
  if (c.outcome != null) { num += w.outcome * c.outcome; den += w.outcome; }
  if (c.reliability != null) { num += w.reliability * c.reliability; den += w.reliability; }
  if (den === 0) return null;
  return num / den;
}

function reliabilityOf(status: string): number | null {
  if (status === 'done') return 1;
  if (status === 'error' || status === 'cancelled') return 0;
  return null; // running / unknown — not terminal, don't score
}

interface UnscoredTask { id: number; agent_id: string; status: string; completed_at: Date }

// Per-agent approval ratio over a recent window: approved / (approved+rejected).
async function approvalByAgent(sinceDays = 45): Promise<Map<string, number>> {
  const rows = (await sql()`
    SELECT created_by AS agent,
           count(*) FILTER (WHERE status = 'approved')::int AS approved,
           count(*) FILTER (WHERE status = 'rejected')::int AS rejected
    FROM public.agent_drafts
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
      AND created_by IS NOT NULL
      AND reviewed_at IS NOT NULL
      AND reviewed_at > now() - (${sinceDays} || ' days')::interval
    GROUP BY created_by
  `) as unknown as Array<{ agent: string; approved: number; rejected: number }>;
  const map = new Map<string, number>();
  for (const r of rows) {
    const total = r.approved + r.rejected;
    if (total > 0) map.set(r.agent, r.approved / total);
  }
  return map;
}

export interface ScoreResult {
  scored: number;
  byAgent: Record<string, { n: number; meanReward: number }>;
  dryRun: boolean;
}

/**
 * Score completed agent_tasks that don't yet have a reward_event. Idempotent
 * (deduped on task_id). Safe to run repeatedly; meant for the improve cron.
 */
export async function scoreUnscoredTasks(opts: { limit?: number; dryRun?: boolean } = {}): Promise<ScoreResult> {
  const limit = Math.min(opts.limit ?? 200, 500);
  const dryRun = !!opts.dryRun;

  const tasks = (await sql()`
    SELECT t.id, t.agent_id, t.status, t.completed_at
    FROM public.agent_tasks t
    WHERE t.tenant_id = ${DEFAULT_TENANT_ID}
      AND t.completed_at IS NOT NULL
      AND t.status IN ('done','error','cancelled')
      AND NOT EXISTS (
        SELECT 1 FROM public.reward_events r
        WHERE r.tenant_id = ${DEFAULT_TENANT_ID} AND r.task_id = t.id
      )
    ORDER BY t.completed_at ASC
    LIMIT ${limit}
  `) as unknown as UnscoredTask[];

  const approvals = await approvalByAgent();
  // Current per-agent run counts (for cold/warm staging).
  const policyRows = (await sql()`
    SELECT agent_id, n FROM public.agent_policy WHERE tenant_id = ${DEFAULT_TENANT_ID} AND variant = 'base'
  `) as unknown as Array<{ agent_id: string; n: number }>;
  const counts = new Map(policyRows.map((r) => [r.agent_id, r.n]));

  const agg: Record<string, { n: number; sum: number }> = {};

  for (const t of tasks) {
    const reliability = reliabilityOf(t.status);
    if (reliability == null) continue;
    const role = roleFor(t.agent_id);
    const approval = approvals.has(t.agent_id) ? approvals.get(t.agent_id)! : null;
    const outcome: Component = null; // TODO(outcome): goal/campaign-event attribution + the flip
    const stage: 'cold' | 'warm' = (counts.get(t.agent_id) ?? 0) >= WARM_THRESHOLD ? 'warm' : 'cold';
    const weights = stageWeights(stage);
    const reward = blend({ approval, outcome, reliability }, weights);
    if (reward == null) continue;

    if (!dryRun) {
      await sql()`
        INSERT INTO public.reward_events (tenant_id, task_id, agent_id, role, reward, components, weights, stage)
        VALUES (${DEFAULT_TENANT_ID}, ${t.id}, ${t.agent_id}, ${role}, ${reward},
                ${jsonb({ approval, outcome, reliability })}, ${jsonb(weights)}, ${stage})
        ON CONFLICT (tenant_id, task_id) WHERE task_id IS NOT NULL DO NOTHING
      `;
      await sql()`
        INSERT INTO public.agent_policy (tenant_id, role, agent_id, variant, n, reward_sum, reward_mean, last_reward, updated_at)
        VALUES (${DEFAULT_TENANT_ID}, ${role}, ${t.agent_id}, 'base', 1, ${reward}, ${reward}, ${reward}, now())
        ON CONFLICT (tenant_id, role, agent_id, variant) DO UPDATE
          SET n = public.agent_policy.n + 1,
              reward_sum = public.agent_policy.reward_sum + ${reward},
              reward_mean = (public.agent_policy.reward_sum + ${reward}) / (public.agent_policy.n + 1),
              last_reward = ${reward},
              updated_at = now()
      `;
      counts.set(t.agent_id, (counts.get(t.agent_id) ?? 0) + 1);
    }

    const a = (agg[t.agent_id] ??= { n: 0, sum: 0 });
    a.n += 1; a.sum += reward;
  }

  const byAgent: ScoreResult['byAgent'] = {};
  for (const [agent, v] of Object.entries(agg)) byAgent[agent] = { n: v.n, meanReward: v.sum / v.n };
  return { scored: Object.values(agg).reduce((s, v) => s + v.n, 0), byAgent, dryRun };
}

// ── Reads for the Learning view ─────────────────────────────────────────────

export interface PolicyRow { role: string; agent_id: string; variant: string; n: number; reward_mean: number; last_reward: number | null; updated_at: string }

export async function getPolicy(): Promise<PolicyRow[]> {
  const rows = (await sql()`
    SELECT role, agent_id, variant, n, reward_mean, last_reward, updated_at
    FROM public.agent_policy WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY reward_mean DESC, n DESC
  `) as unknown as Array<Omit<PolicyRow, 'updated_at'> & { updated_at: Date }>;
  return rows.map((r) => ({ ...r, reward_mean: Number(r.reward_mean), last_reward: r.last_reward == null ? null : Number(r.last_reward), updated_at: new Date(r.updated_at).toISOString() }));
}

export interface RewardEventRow { task_id: number | null; agent_id: string; role: string; reward: number; components: { approval: number | null; outcome: number | null; reliability: number | null }; stage: string; scored_at: string }

export async function recentRewardEvents(limit = 50): Promise<RewardEventRow[]> {
  const rows = (await sql()`
    SELECT task_id, agent_id, role, reward, components, stage, scored_at
    FROM public.reward_events WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY scored_at DESC LIMIT ${Math.min(limit, 200)}
  `) as unknown as Array<Omit<RewardEventRow, 'reward' | 'scored_at'> & { reward: string | number; scored_at: Date }>;
  return rows.map((r) => ({ ...r, reward: Number(r.reward), scored_at: new Date(r.scored_at).toISOString() }));
}
