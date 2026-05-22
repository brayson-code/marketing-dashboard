// Agent Studio store. Agent definitions live in agent_defs so they can be
// viewed/edited/created live from the Workspace, and so the orchestrator can
// resolve its roster + each sub-agent's prompt from the DB (with the bundled
// agents/** files as fallback). Backend uses the RLS-bypassing postgres role, so
// every query scopes tenant_id explicitly.

import { sql, DEFAULT_TENANT_ID } from './db/client';

export interface AgentDef {
  id: string;
  name: string;
  role: string;
  model: string;
  max_tokens: number;
  rate_per_hour: number;
  description: string;
  soul: string;
  agent_md: string;
  skills: string;
  spawnable: boolean;
  enabled: boolean;
  source: string;
  created_at: string;
  updated_at: string;
}

export type AgentDefListItem = Omit<AgentDef, 'soul' | 'agent_md' | 'skills' | 'created_at'>;

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const ROLES = ['research', 'content', 'outreach', 'scheduler', 'creative', 'general', 'orchestrator'];

interface Raw { [k: string]: unknown; updated_at: Date; created_at?: Date }
function iso(d: Date): string { return new Date(d).toISOString(); }

export async function listAgentDefs(): Promise<AgentDefListItem[]> {
  const rows = (await sql()`
    SELECT id, name, role, model, max_tokens, rate_per_hour, description, spawnable, enabled, source, updated_at
    FROM public.agent_defs WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY spawnable DESC, name ASC
  `) as unknown as Array<AgentDefListItem & { updated_at: Date }>;
  return rows.map((r) => ({ ...r, updated_at: iso(r.updated_at) }));
}

export async function getAgentDef(id: string): Promise<AgentDef | null> {
  const rows = (await sql()`
    SELECT * FROM public.agent_defs WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id}
  `) as unknown as Array<AgentDef & Raw>;
  const r = rows[0];
  if (!r) return null;
  return { ...(r as unknown as AgentDef), created_at: iso(r.created_at as Date), updated_at: iso(r.updated_at) };
}

// ── Runtime resolvers (used by subagent.ts + orchestrator.ts) ───────────────

export interface AgentSpecLite { id: string; model: string; maxTokens: number; ratePerHour: number; description: string }

/** Enabled, spawnable specs — the live roster for the orchestrator's tool enum. */
export async function listSpawnableSpecs(): Promise<AgentSpecLite[]> {
  const rows = (await sql()`
    SELECT id, model, max_tokens, rate_per_hour, description FROM public.agent_defs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND spawnable = true AND enabled = true
    ORDER BY id
  `) as unknown as Array<{ id: string; model: string; max_tokens: number; rate_per_hour: number; description: string }>;
  return rows.map((r) => ({ id: r.id, model: r.model, maxTokens: r.max_tokens, ratePerHour: r.rate_per_hour, description: r.description }));
}

/** Spec for one agent if it exists, is spawnable, and enabled; else null. */
export async function getSpawnSpec(id: string): Promise<AgentSpecLite | null> {
  const rows = (await sql()`
    SELECT id, model, max_tokens, rate_per_hour, description, spawnable, enabled
    FROM public.agent_defs WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id}
  `) as unknown as Array<{ id: string; model: string; max_tokens: number; rate_per_hour: number; description: string; spawnable: boolean; enabled: boolean }>;
  const r = rows[0];
  if (!r || !r.spawnable || !r.enabled) return null;
  return { id: r.id, model: r.model, maxTokens: r.max_tokens, ratePerHour: r.rate_per_hour, description: r.description };
}

/** Combined raw system prompt (soul + agent + skills) from the DB def, or null. */
export async function getDefPrompt(id: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT soul, agent_md, skills FROM public.agent_defs WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id}
  `) as unknown as Array<{ soul: string; agent_md: string; skills: string }>;
  const r = rows[0];
  if (!r) return null;
  const parts = [r.soul, r.agent_md, r.skills].filter((s) => s && s.trim());
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

// ── Writes (Agent Studio + seeding) ─────────────────────────────────────────

export interface AgentDefInput {
  id?: string;
  name?: string;
  role?: string;
  model?: string;
  max_tokens?: number;
  rate_per_hour?: number;
  description?: string;
  soul?: string;
  agent_md?: string;
  skills?: string;
  spawnable?: boolean;
  enabled?: boolean;
  source?: string;
}

function clampInt(v: unknown, lo: number, hi: number, dflt: number): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

export async function createAgentDef(input: AgentDefInput): Promise<AgentDef> {
  const id = String(input.id ?? '').trim().toLowerCase();
  if (!SLUG.test(id) || id.length > 64) throw new Error('Invalid id — use lowercase letters, digits, hyphens (e.g. "n8n-builder").');
  if (await getAgentDef(id)) throw new Error(`Agent "${id}" already exists`);
  const name = String(input.name ?? '').trim() || id;
  const role = ROLES.includes(String(input.role)) ? String(input.role) : 'general';
  await sql()`
    INSERT INTO public.agent_defs (tenant_id, id, name, role, model, max_tokens, rate_per_hour, description, soul, agent_md, skills, spawnable, enabled, source)
    VALUES (${DEFAULT_TENANT_ID}, ${id}, ${name}, ${role},
            ${String(input.model ?? 'claude-sonnet-4-6')}, ${clampInt(input.max_tokens, 256, 200000, 4096)},
            ${clampInt(input.rate_per_hour, 1, 1000, 30)}, ${String(input.description ?? '')},
            ${String(input.soul ?? '')}, ${String(input.agent_md ?? '')}, ${String(input.skills ?? '')},
            ${input.spawnable !== false}, ${input.enabled !== false}, ${input.source === 'builtin' ? 'builtin' : 'custom'})
  `;
  const created = await getAgentDef(id);
  if (!created) throw new Error('Create failed');
  return created;
}

export async function updateAgentDef(id: string, fields: AgentDefInput): Promise<AgentDef | null> {
  const role = fields.role !== undefined ? (ROLES.includes(String(fields.role)) ? String(fields.role) : null) : null;
  const rows = (await sql()`
    UPDATE public.agent_defs SET
      name          = COALESCE(${fields.name ?? null}, name),
      role          = COALESCE(${role}, role),
      model         = COALESCE(${fields.model ?? null}, model),
      max_tokens    = COALESCE(${fields.max_tokens === undefined ? null : clampInt(fields.max_tokens, 256, 200000, 4096)}, max_tokens),
      rate_per_hour = COALESCE(${fields.rate_per_hour === undefined ? null : clampInt(fields.rate_per_hour, 1, 1000, 30)}, rate_per_hour),
      description   = COALESCE(${fields.description ?? null}, description),
      soul          = COALESCE(${fields.soul ?? null}, soul),
      agent_md      = COALESCE(${fields.agent_md ?? null}, agent_md),
      skills        = COALESCE(${fields.skills ?? null}, skills),
      spawnable     = COALESCE(${fields.spawnable ?? null}, spawnable),
      enabled       = COALESCE(${fields.enabled ?? null}, enabled),
      updated_at    = now()
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id}
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  if (rows.length === 0) return null;
  return getAgentDef(id);
}

export async function deleteAgentDef(id: string): Promise<boolean> {
  // Builtins can be disabled but not deleted (they have a file fallback + are
  // referenced by the registry); only custom agents can be removed.
  const rows = (await sql()`
    DELETE FROM public.agent_defs
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND id = ${id} AND source = 'custom'
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Idempotent upsert for seeding builtins from the bundled files. */
export async function upsertAgentDef(input: Required<Pick<AgentDefInput, 'id'>> & AgentDefInput): Promise<void> {
  const id = String(input.id).trim().toLowerCase();
  await sql()`
    INSERT INTO public.agent_defs (tenant_id, id, name, role, model, max_tokens, rate_per_hour, description, soul, agent_md, skills, spawnable, enabled, source)
    VALUES (${DEFAULT_TENANT_ID}, ${id}, ${input.name ?? id}, ${input.role ?? 'general'},
            ${input.model ?? 'claude-sonnet-4-6'}, ${clampInt(input.max_tokens, 256, 200000, 4096)},
            ${clampInt(input.rate_per_hour, 1, 1000, 30)}, ${input.description ?? ''},
            ${input.soul ?? ''}, ${input.agent_md ?? ''}, ${input.skills ?? ''},
            ${input.spawnable !== false}, ${input.enabled !== false}, ${input.source ?? 'builtin'})
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      name = EXCLUDED.name, role = EXCLUDED.role, model = EXCLUDED.model,
      max_tokens = EXCLUDED.max_tokens, rate_per_hour = EXCLUDED.rate_per_hour,
      description = EXCLUDED.description, soul = EXCLUDED.soul, agent_md = EXCLUDED.agent_md,
      skills = EXCLUDED.skills, updated_at = now()
  `;
}
