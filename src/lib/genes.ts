// Strategy genes — the readable, curatable form of the self-improving loop.
// Where PARL (reward.ts) tunes hidden numbers, a "gene" captures a winning
// approach as a compact, named, versioned instruction with provenance + a track
// record. Active genes are INJECTED into matching agents' tasks at spawn; the
// reward loop UPDATES their stats and can PROPOSE new ones from variants that
// reliably win. Everything is auditable via gene_events.
//
// SAFE BY DESIGN / REVERTIBLE:
//   • New tables only (0019) — drop them to revert the data.
//   • Genes are born 'proposed' (inert). Only 'active' genes ever touch an agent,
//     and only after the owner approves them — so behavior == today until you opt in.
//   • A single global kill switch (gene_config.enabled) turns injection off instantly.

import { sql, jsonb, tenantId } from './db/client';
import { roleFor, constraintsForVariant, type AgentRole } from './constraints';

export type GeneStatus = 'proposed' | 'active' | 'retired';

export interface StrategyGene {
  id: number;
  name: string;
  title: string;
  body: string;
  role: string;
  agent_id: string | null;
  status: GeneStatus;
  version: number;
  tries: number;
  wins: number;
  reward_mean: number;
  source: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface GeneEvent {
  id: number;
  gene_id: number;
  kind: string;
  detail: Record<string, unknown> | null;
  created_at: string;
}

const SELECT_LIMIT = 3;          // max genes injected into a single task
const WIN_THRESHOLD = 0.6;       // reward at/above this counts as a "win"
const PROPOSE_MIN_TRIES = 8;     // policy evidence before a variant is gene-worthy
const PROPOSE_MIN_MEAN = 0.65;   // and it must be performing this well

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 60);
}

// ── Kill switch ─────────────────────────────────────────────────────────────

/** Global on/off. Defaults to ON (table default), but no gene affects an agent
 *  until it's 'active', so "on" alone changes nothing until you approve a gene. */
export async function genesEnabled(): Promise<boolean> {
  try {
    const rows = (await sql()`
      SELECT enabled FROM public.gene_config WHERE tenant_id = ${tenantId()}
    `) as unknown as Array<{ enabled: boolean }>;
    return rows[0]?.enabled ?? true;
  } catch {
    return false; // fail safe: if the table/feature is gone, behave like today
  }
}

export async function setGenesEnabled(on: boolean): Promise<void> {
  await sql()`
    INSERT INTO public.gene_config (tenant_id, enabled, updated_at)
    VALUES (${tenantId()}, ${on}, now())
    ON CONFLICT (tenant_id) DO UPDATE SET enabled = ${on}, updated_at = now()
  `;
}

// ── Events (audit trail) ─────────────────────────────────────────────────────

async function logGeneEvent(geneId: number, kind: string, detail?: Record<string, unknown>): Promise<void> {
  await sql()`
    INSERT INTO public.gene_events (tenant_id, gene_id, kind, detail)
    VALUES (${tenantId()}, ${geneId}, ${kind}, ${detail ? jsonb(detail) : null})
  `.catch(() => {});
}

export async function listGeneEvents(geneId: number, limit = 30): Promise<GeneEvent[]> {
  const rows = (await sql()`
    SELECT id, gene_id, kind, detail, created_at FROM public.gene_events
    WHERE tenant_id = ${tenantId()} AND gene_id = ${geneId}
    ORDER BY created_at DESC LIMIT ${limit}
  `) as unknown as Array<Omit<GeneEvent, 'created_at'> & { created_at: Date }>;
  return rows.map((r) => ({ ...r, created_at: new Date(r.created_at).toISOString() }));
}

// ── CRUD / deck ──────────────────────────────────────────────────────────────

function rowToGene(r: Record<string, unknown>): StrategyGene {
  return {
    id: Number(r.id), name: String(r.name), title: String(r.title), body: String(r.body),
    role: String(r.role), agent_id: (r.agent_id as string | null) ?? null,
    status: r.status as GeneStatus, version: Number(r.version), tries: Number(r.tries),
    wins: Number(r.wins), reward_mean: Number(r.reward_mean), source: (r.source as string | null) ?? null,
    created_by: (r.created_by as string | null) ?? null,
    created_at: new Date(r.created_at as string).toISOString(),
    updated_at: new Date(r.updated_at as string).toISOString(),
  };
}

export async function listGenes(filters: { status?: GeneStatus; role?: string } = {}): Promise<StrategyGene[]> {
  const rows = (await sql()`
    SELECT * FROM public.strategy_genes
    WHERE tenant_id = ${tenantId()}
      AND (${filters.status ?? null}::text IS NULL OR status = ${filters.status ?? null})
      AND (${filters.role ?? null}::text IS NULL OR role = ${filters.role ?? null})
    ORDER BY (status = 'active') DESC, reward_mean DESC, updated_at DESC
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(rowToGene);
}

export async function getGene(id: number): Promise<StrategyGene | null> {
  const rows = (await sql()`
    SELECT * FROM public.strategy_genes WHERE id = ${id} AND tenant_id = ${tenantId()}
  `) as unknown as Array<Record<string, unknown>>;
  return rows[0] ? rowToGene(rows[0]) : null;
}

export interface CreateGeneInput {
  title: string;
  body: string;
  role: string;
  agentId?: string | null;
  status?: GeneStatus;     // default 'active' for owner-minted, 'proposed' for auto
  source?: string;
  createdBy?: string;
  name?: string;           // optional explicit slug (for idempotent auto-propose)
}

/** Mint a gene. Owner-minted defaults to 'active'; auto-proposed pass status 'proposed'. */
export async function createGene(input: CreateGeneInput): Promise<StrategyGene | null> {
  const name = input.name ?? slugify(input.title) ?? `gene-${Date.now()}`;
  const status = input.status ?? 'active';
  const rows = (await sql()`
    INSERT INTO public.strategy_genes (tenant_id, name, title, body, role, agent_id, status, source, created_by)
    VALUES (${tenantId()}, ${name}, ${input.title}, ${input.body}, ${input.role},
            ${input.agentId ?? null}, ${status}, ${input.source ?? null}, ${input.createdBy ?? null})
    ON CONFLICT (tenant_id, name) DO NOTHING
    RETURNING *
  `) as unknown as Array<Record<string, unknown>>;
  if (!rows[0]) return null; // already exists (idempotent)
  const gene = rowToGene(rows[0]);
  await logGeneEvent(gene.id, status === 'proposed' ? 'proposed' : 'minted', { source: input.source });
  return gene;
}

export async function updateGene(id: number, fields: { title?: string; body?: string; agentId?: string | null }): Promise<StrategyGene | null> {
  await sql()`
    UPDATE public.strategy_genes SET
      title = COALESCE(${fields.title ?? null}, title),
      body  = COALESCE(${fields.body ?? null}, body),
      version = version + 1,
      updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  // agent_id is nullable, so COALESCE can't express "set to null" vs "leave alone" — update it explicitly only when provided.
  if (fields.agentId !== undefined) {
    await sql()`
      UPDATE public.strategy_genes SET agent_id = ${fields.agentId}
      WHERE id = ${id} AND tenant_id = ${tenantId()}
    `;
  }
  await logGeneEvent(id, 'edited', { fields });
  return getGene(id);
}

export async function setGeneStatus(id: number, status: GeneStatus): Promise<StrategyGene | null> {
  await sql()`
    UPDATE public.strategy_genes SET status = ${status}, updated_at = now()
    WHERE id = ${id} AND tenant_id = ${tenantId()}
  `;
  await logGeneEvent(id, status === 'active' ? 'approved' : status === 'retired' ? 'retired' : status, {});
  return getGene(id);
}

// ── Selection / injection (used at spawn) ────────────────────────────────────

/** Active genes that apply to this (role, agent), best-first. Empty if disabled. */
export async function selectGenesForTask(agentId: string): Promise<StrategyGene[]> {
  if (!(await genesEnabled())) return [];
  const role = roleFor(agentId);
  const rows = (await sql()`
    SELECT * FROM public.strategy_genes
    WHERE tenant_id = ${tenantId()} AND status = 'active' AND role = ${role}
      AND (agent_id IS NULL OR agent_id = ${agentId})
    ORDER BY reward_mean DESC, wins DESC, updated_at DESC
    LIMIT ${SELECT_LIMIT}
  `) as unknown as Array<Record<string, unknown>>;
  return rows.map(rowToGene);
}

/** Format genes into an instruction block appended to the agent's task. */
export function genesDirective(genes: StrategyGene[]): string {
  if (genes.length === 0) return '';
  const lines = genes.map((g) => `- ${g.title}: ${g.body}`).join('\n');
  return `Learned strategies — apply these; they've worked before for this kind of task:\n${lines}`;
}

/** Record that these genes were injected into a task (audit; attribution is via metadata.genes). */
export async function recordGeneApplications(geneIds: number[], taskId: number): Promise<void> {
  for (const id of geneIds) await logGeneEvent(id, 'applied', { task_id: taskId });
}

// ── Reward integration ────────────────────────────────────────────────────────

/** Update a gene's track record from a scored task that used it. Called by the reward loop. */
export async function rewardGenes(geneIds: number[], reward: number): Promise<void> {
  const win = reward >= WIN_THRESHOLD ? 1 : 0;
  for (const id of geneIds) {
    await sql()`
      UPDATE public.strategy_genes SET
        tries = tries + 1,
        wins = wins + ${win},
        reward_sum = reward_sum + ${reward},
        reward_mean = (reward_sum + ${reward}) / (tries + 1),
        updated_at = now()
      WHERE id = ${id} AND tenant_id = ${tenantId()}
    `;
    await logGeneEvent(id, 'rewarded', { reward, win: !!win });
  }
}

/**
 * Scan the policy table for (role, agent, variant) combos that have proven
 * themselves (enough tries + high mean) and PROPOSE a gene capturing that
 * variant's constraint as a starting strategy. Proposed = inert until approved.
 * Idempotent (stable slug + ON CONFLICT DO NOTHING). Returns how many were proposed.
 */
export async function proposeGenesFromPolicy(): Promise<number> {
  const rows = (await sql()`
    SELECT DISTINCT ON (agent_id) agent_id, role, variant, n, reward_mean
    FROM public.agent_policy
    WHERE tenant_id = ${tenantId()} AND n >= ${PROPOSE_MIN_TRIES} AND reward_mean >= ${PROPOSE_MIN_MEAN}
    ORDER BY agent_id, reward_mean DESC
  `) as unknown as Array<{ agent_id: string; role: string; variant: string; n: number; reward_mean: number }>;

  let proposed = 0;
  for (const r of rows) {
    if (r.variant === 'base') continue; // base is the default; only mint when a non-default variant wins
    const role = (r.role || roleFor(r.agent_id)) as AgentRole;
    const body = constraintsForVariant(r.agent_id, r.variant);
    const name = `auto-${role}-${r.agent_id}-${r.variant}`;
    const mean = Number(r.reward_mean); // numeric may arrive as string from pg
    const created = await createGene({
      name,
      title: `"${r.variant}" approach for ${r.agent_id}`,
      body,
      role,
      agentId: r.agent_id,
      status: 'proposed',
      source: `policy: ${r.variant} averaged ${mean.toFixed(2)} over ${Number(r.n)} runs`,
      createdBy: 'reward-loop',
    });
    if (created) proposed++;
  }
  return proposed;
}
