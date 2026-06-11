// Agent Studio store. Agent definitions live in agent_defs so they can be
// viewed/edited/created live from the Workspace, and so the orchestrator can
// resolve its roster + each sub-agent's prompt from the DB (with the bundled
// agents/** files as fallback). Backend uses the RLS-bypassing postgres role, so
// every query scopes tenant_id explicitly.

import { sql, tenantId } from './db/client';

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
    FROM public.agent_defs WHERE tenant_id = ${tenantId()}
    ORDER BY spawnable DESC, name ASC
  `) as unknown as Array<AgentDefListItem & { updated_at: Date }>;
  const items: AgentDefListItem[] = rows.map((r) => ({ ...r, updated_at: iso(r.updated_at) }));
  // Append bundled built-ins not yet saved for this tenant, so Agent Studio
  // lists every agent the squad can spawn — each editable (copy-on-write: the
  // first Save materializes a real row). Matches the squad page's roster.
  const seen = new Set(items.map((i) => i.id));
  for (const b of await bundledListItems()) if (!seen.has(b.id)) items.push(b);
  return items;
}

export async function getAgentDef(id: string): Promise<AgentDef | null> {
  const rows = (await sql()`
    SELECT * FROM public.agent_defs WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as Array<AgentDef & Raw>;
  const r = rows[0];
  if (!r) return null;
  return { ...(r as unknown as AgentDef), created_at: iso(r.created_at as Date), updated_at: iso(r.updated_at) };
}

// ── Bundled (un-seeded) specialist fallback ──────────────────────────────────
// The squad page lists the bundled specialists (agents/sub-agents/**) even when
// they haven't been written into agent_defs for this tenant. Those specialists
// spawn through subagent.ts, which resolves its prompt DB-first with the bundled
// files as fallback — so editing then Saving here takes effect live (copy-on-
// write: the first Save materializes a real row).
//
// Scoped to SUBAGENT_REGISTRY on purpose. The orchestrator (keyplayer) and the
// system agents (fixer/improver) load their prompts elsewhere and are NOT spawned
// as specialists, so (a) editing them through this path would be inert, and
// (b) materializing them spawnable=true would poison the orchestrator's spawn
// enum (it would then try to spawn an agent with no template and throw). We only
// ever synthesize / materialize the real specialists. Dynamic imports break the
// agent-defs → squad → subagent → agent-defs require cycle.

// Best-effort editor role enum so the dropdown lands sane before the first Save.
const BUNDLED_ROLE: Record<string, string> = {
  'research-analyst': 'research',
  'lead-research': 'research',
  'content-writer': 'content',
  'outreach-sender': 'outreach',
  'calendar-scheduler': 'scheduler',
  'memory-compactor': 'general',
  'thumbnail-generator': 'creative',
  'hyperframes-agent': 'creative',
};

const EPOCH0 = new Date(0).toISOString(); // "not saved yet" marker for synthesized rows

async function bundledListItems(): Promise<AgentDefListItem[]> {
  const { squadRoster } = await import('./squad');
  const { SUBAGENT_REGISTRY } = await import('./subagent');
  return squadRoster()
    .filter((m) => SUBAGENT_REGISTRY[m.id]) // real specialists only
    .map((m) => {
      const spec = SUBAGENT_REGISTRY[m.id];
      return {
        id: m.id, name: m.name, role: BUNDLED_ROLE[m.id] ?? 'general',
        model: spec.model, max_tokens: spec.maxTokens, rate_per_hour: spec.ratePerHour,
        description: m.description, spawnable: true, enabled: true,
        source: 'builtin', updated_at: EPOCH0,
      };
    });
}

/** A full def synthesized from a specialist's bundled agents/sub-agents/<id>/*.md
 *  files when it isn't saved into agent_defs yet — PLUS the orchestrator
 *  (keyplayer), synthesized from agents/keyplayer/*.md as a NON-spawnable builtin
 *  so its prompt is live-editable from Agent Studio (its prompt loads DB-first in
 *  orchestrator.ts, identical to the specialists via subagent.ts). Reads
 *  soul/agent/skills as distinct fields (the editor edits them separately).
 *  Returns null for anything that isn't a real bundled specialist or keyplayer
 *  (the system agents fixer/improver load their prompts elsewhere). */
async function bundledAgentDef(id: string): Promise<AgentDef | null> {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { squadRoster } = await import('./squad');
  const meta = squadRoster().find((a) => a.id === id);

  // The orchestrator: read from agents/keyplayer (NOT agents/sub-agents/keyplayer),
  // role=orchestrator, and CRITICALLY spawnable=false so it can never enter the
  // spawn enum (listSpawnableSpecs/getSpawnSpec filter spawnable=true).
  if (id === 'keyplayer') {
    const dir = path.join(process.cwd(), 'agents/keyplayer');
    const read = (f: string) => {
      try { return fs.readFileSync(path.join(dir, f), 'utf-8'); } catch { return ''; }
    };
    return {
      id,
      name: meta?.name ?? 'KeyPlayer',
      role: 'orchestrator',
      model: meta?.model ?? 'claude-sonnet-4-6',
      max_tokens: 8000,
      rate_per_hour: 60,
      description: meta?.description ?? 'The main agent. Plans the work and dispatches the squad.',
      soul: read('soul.md'),
      agent_md: read('agent.md'),
      skills: read('skills.md'),
      spawnable: false,
      enabled: true,
      source: 'builtin',
      created_at: EPOCH0,
      updated_at: EPOCH0,
    };
  }

  const { SUBAGENT_REGISTRY } = await import('./subagent');
  const spec = SUBAGENT_REGISTRY[id];
  if (!spec) return null;
  const dir = path.join(process.cwd(), 'agents/sub-agents', id);
  const read = (f: string) => {
    try { return fs.readFileSync(path.join(dir, f), 'utf-8'); } catch { return ''; }
  };
  return {
    id,
    name: meta?.name ?? id,
    role: BUNDLED_ROLE[id] ?? 'general',
    model: spec.model,
    max_tokens: spec.maxTokens,
    rate_per_hour: spec.ratePerHour,
    description: meta?.description ?? spec.description,
    soul: read('soul.md'),
    agent_md: read('agent.md'),
    skills: read('skills.md'),
    spawnable: true,
    enabled: true,
    source: 'builtin',
    created_at: EPOCH0,
    updated_at: EPOCH0,
  };
}

/** Full def for the Studio editor: the saved row if present, else the bundled
 *  specialist fallback (copy-on-write; the first Save materializes it). */
export async function getAgentDefForEditor(id: string): Promise<AgentDef | null> {
  return (await getAgentDef(id)) ?? bundledAgentDef(id);
}

/** Ensure a real agent_defs row exists for a bundled builtin (idempotent).
 *  No-op if the row already exists. Otherwise materializes the bundled def
 *  (getAgentDefForEditor → upsertAgentDef) so writes that UPDATE the row — e.g.
 *  setAgentPulse — actually persist across runs instead of silently no-op'ing on
 *  a missing row. Used by the reel pipeline before spawning reel-analyst so its
 *  PULSE carries over between watchlist sweeps. */
export async function ensureBundledAgentRow(id: string): Promise<void> {
  if (await getAgentDef(id)) return;
  const def = await getAgentDefForEditor(id);
  if (!def) return;
  await upsertAgentDef({
    id: def.id,
    name: def.name,
    role: def.role,
    model: def.model,
    max_tokens: def.max_tokens,
    rate_per_hour: def.rate_per_hour,
    description: def.description,
    soul: def.soul,
    agent_md: def.agent_md,
    skills: def.skills,
    spawnable: def.spawnable,
    enabled: def.enabled,
    source: 'builtin',
  });
}

/** True if `id` is a bundled agent the editor can open + a Save may materialize
 *  copy-on-write, with prompt edits taking effect live: the real specialists (via
 *  subagent.ts) and the orchestrator keyplayer (via orchestrator.ts loadTemplate).
 *  Excludes the system agents fixer/improver (whose prompts live elsewhere).
 *  Note: a materialized keyplayer row is spawnable=false, so it never enters the
 *  spawn enum (listSpawnableSpecs/getSpawnSpec filter spawnable=true). */
export async function isKnownBundledAgent(id: string): Promise<boolean> {
  if (id === 'keyplayer') return true;
  const { SUBAGENT_REGISTRY } = await import('./subagent');
  return !!SUBAGENT_REGISTRY[id];
}

// ── Runtime resolvers (used by subagent.ts + orchestrator.ts) ───────────────

export interface AgentSpecLite { id: string; model: string; maxTokens: number; ratePerHour: number; description: string }

/** Enabled, spawnable specs — the live roster for the orchestrator's tool enum. */
export async function listSpawnableSpecs(): Promise<AgentSpecLite[]> {
  const rows = (await sql()`
    SELECT id, model, max_tokens, rate_per_hour, description FROM public.agent_defs
    WHERE tenant_id = ${tenantId()} AND spawnable = true AND enabled = true
    ORDER BY id
  `) as unknown as Array<{ id: string; model: string; max_tokens: number; rate_per_hour: number; description: string }>;
  return rows.map((r) => ({ id: r.id, model: r.model, maxTokens: r.max_tokens, ratePerHour: r.rate_per_hour, description: r.description }));
}

/** Spec for one agent if it exists, is spawnable, and enabled; else null. */
export async function getSpawnSpec(id: string): Promise<AgentSpecLite | null> {
  const rows = (await sql()`
    SELECT id, model, max_tokens, rate_per_hour, description, spawnable, enabled
    FROM public.agent_defs WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as Array<{ id: string; model: string; max_tokens: number; rate_per_hour: number; description: string; spawnable: boolean; enabled: boolean }>;
  const r = rows[0];
  if (!r || !r.spawnable || !r.enabled) return null;
  return { id: r.id, model: r.model, maxTokens: r.max_tokens, ratePerHour: r.rate_per_hour, description: r.description };
}

/** Combined raw system prompt (soul + agent + skills + pulse) from the DB def, or null. */
export async function getDefPrompt(id: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT soul, agent_md, skills, pulse FROM public.agent_defs
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as Array<{ soul: string; agent_md: string; skills: string; pulse: string }>;
  const r = rows[0];
  if (!r) return null;
  const parts = [r.soul, r.agent_md, r.skills].filter((s) => s && s.trim());
  if (r.pulse && r.pulse.trim()) {
    // Always last block so it reads as the freshest context the model sees.
    parts.push(`## Pulse (your rolling state)\n\n${r.pulse.trim()}`);
  }
  return parts.length ? parts.join('\n\n---\n\n') : null;
}

// Pulse upper bound — long enough for continuity, short enough not to bloat
// the prompt every run. Anything over this gets trimmed from the head (oldest).
const PULSE_MAX = 1200;

/** Read the current pulse for an agent, defaulting to empty when unset. */
export async function getAgentPulse(id: string): Promise<string> {
  const rows = (await sql()`
    SELECT pulse FROM public.agent_defs WHERE tenant_id = ${tenantId()} AND id = ${id}
  `) as unknown as Array<{ pulse: string }>;
  return rows[0]?.pulse ?? '';
}

/** Replace the pulse for an agent. Trims to PULSE_MAX from the head, keeping
 *  the tail (most recent observations). Pass empty to clear. */
export async function setAgentPulse(id: string, next: string): Promise<void> {
  let trimmed = (next ?? '').trim();
  if (trimmed.length > PULSE_MAX) trimmed = '…\n' + trimmed.slice(-PULSE_MAX + 2);
  await sql()`
    UPDATE public.agent_defs
    SET pulse = ${trimmed}, updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
  `;
}

/** Parse a "## Pulse update" block out of an agent's response text. Tolerant of
 *  variants ("Pulse update:", "### Pulse", with or without trailing fence). */
export function parsePulseUpdate(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/^[ \t]*#{1,3}[ \t]*pulse[ \t]*(?:update|state)?[ \t]*[:\-]?[ \t]*$([\s\S]*?)(?=^[ \t]*#{1,3}[ \t]|$(?![\s\S]))/im);
  if (!m) return null;
  const body = m[1]
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  return body || null;
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
    VALUES (${tenantId()}, ${id}, ${name}, ${role},
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
  // HARD INVARIANT: the orchestrator can never be flipped spawnable via an edit
  // (see upsertAgentDef). Force false for keyplayer; otherwise COALESCE the field.
  const spawnable = id === 'keyplayer' ? false : (fields.spawnable ?? null);
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
      spawnable     = COALESCE(${spawnable}, spawnable),
      enabled       = COALESCE(${fields.enabled ?? null}, enabled),
      updated_at    = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
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
    WHERE tenant_id = ${tenantId()} AND id = ${id} AND source = 'custom'
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length > 0;
}

/** Idempotent upsert for seeding builtins from the bundled files. */
export async function upsertAgentDef(input: Required<Pick<AgentDefInput, 'id'>> & AgentDefInput): Promise<void> {
  const id = String(input.id).trim().toLowerCase();
  // HARD INVARIANT: the orchestrator is never spawnable, no matter what the
  // copy-on-write Save body sends. A spawnable keyplayer row would poison the
  // spawn enum (listSpawnableSpecs/getSpawnSpec filter spawnable=true), so we
  // force it false here at the data layer regardless of caller input.
  const spawnable = id === 'keyplayer' ? false : input.spawnable !== false;
  await sql()`
    INSERT INTO public.agent_defs (tenant_id, id, name, role, model, max_tokens, rate_per_hour, description, soul, agent_md, skills, spawnable, enabled, source)
    VALUES (${tenantId()}, ${id}, ${input.name ?? id}, ${input.role ?? 'general'},
            ${input.model ?? 'claude-sonnet-4-6'}, ${clampInt(input.max_tokens, 256, 200000, 4096)},
            ${clampInt(input.rate_per_hour, 1, 1000, 30)}, ${input.description ?? ''},
            ${input.soul ?? ''}, ${input.agent_md ?? ''}, ${input.skills ?? ''},
            ${spawnable}, ${input.enabled !== false}, ${input.source ?? 'builtin'})
    ON CONFLICT (tenant_id, id) DO UPDATE SET
      name = EXCLUDED.name, role = EXCLUDED.role, model = EXCLUDED.model,
      max_tokens = EXCLUDED.max_tokens, rate_per_hour = EXCLUDED.rate_per_hour,
      description = EXCLUDED.description, soul = EXCLUDED.soul, agent_md = EXCLUDED.agent_md,
      skills = EXCLUDED.skills, updated_at = now()
  `;
}
