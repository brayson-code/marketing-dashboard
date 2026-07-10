// Agent Library — typed reads over the GLOBAL public.agent_library catalog
// (migration 0058). This is the unified, tenant-agnostic list of reusable agent
// DEFINITIONS that provisioning + the sales console pick from when standing up a
// new command center. The chosen rows are materialized into per-tenant
// agent_defs rows (that copy step lives elsewhere; this module only reads).
//
// The table is global, so — unlike agent-defs.ts — these queries do NOT filter
// by tenant_id. Reads still go through the RLS-bypassing postgres client, so a
// plain SELECT returns the whole catalog regardless of the caller's tenant.

import { sql } from './db/client';

export type AgentRichness = 'thin' | 'rich';

export interface LibraryAgent {
  id: string;
  name: string;
  category: string;
  role: string;
  department: string | null;
  is_executive: boolean;
  does: string;
  soul: string;
  agent_md: string;
  skills: string;
  default_niches: string[];
  tags: string[];
  richness: AgentRichness;
  source: string;
  created_at: string;
}

// Light row for lists/pickers — omits the heavy prompt bodies so the sales
// console can render the whole catalog cheaply. getLibraryAgent() fetches the
// full row (with soul/agent_md/skills) when one is opened.
export type LibraryAgentListItem = Omit<LibraryAgent, 'soul' | 'agent_md' | 'skills' | 'created_at'>;

export interface LibraryFilter {
  category?: string;
  richness?: AgentRichness;
  source?: string;
  /** Only agents whose default_niches contains this industry slug. */
  niche?: string;
  /** Case-insensitive match against name / does / tags. */
  search?: string;
}

interface RawRow {
  id: string; name: string; category: string; role: string;
  department: string | null; is_executive: boolean; does: string;
  default_niches: string[]; tags: string[]; richness: string; source: string;
}

function toListItem(r: RawRow): LibraryAgentListItem {
  return {
    id: r.id, name: r.name, category: r.category, role: r.role,
    department: r.department, is_executive: r.is_executive, does: r.does,
    default_niches: r.default_niches ?? [], tags: r.tags ?? [],
    richness: (r.richness === 'rich' ? 'rich' : 'thin'),
    source: r.source,
  };
}

/**
 * List the catalog (light rows — no prompt bodies), newest-authored first with a
 * stable secondary sort by name. All filters are optional and compose (AND).
 */
export async function listLibrary(filter: LibraryFilter = {}): Promise<LibraryAgentListItem[]> {
  const search = filter.search?.trim().toLowerCase();
  const rows = (await sql()`
    SELECT id, name, category, role, department, is_executive, does,
           default_niches, tags, richness, source
    FROM public.agent_library
    WHERE (${filter.category ?? null}::text IS NULL OR category = ${filter.category ?? null})
      AND (${filter.richness ?? null}::text IS NULL OR richness = ${filter.richness ?? null})
      AND (${filter.source ?? null}::text IS NULL OR source = ${filter.source ?? null})
      AND (${filter.niche ?? null}::text IS NULL OR default_niches @> ARRAY[${filter.niche ?? ''}]::text[])
      AND (
        ${search ?? null}::text IS NULL
        OR lower(name) LIKE '%' || ${search ?? ''} || '%'
        OR lower(does) LIKE '%' || ${search ?? ''} || '%'
        OR EXISTS (SELECT 1 FROM unnest(tags) t WHERE lower(t) LIKE '%' || ${search ?? ''} || '%')
      )
    ORDER BY is_executive DESC, category ASC, name ASC
  `) as unknown as RawRow[];
  return rows.map(toListItem);
}

/** Full catalog row (including soul/agent_md/skills) for one slug, or null. */
export async function getLibraryAgent(slug: string): Promise<LibraryAgent | null> {
  const id = String(slug ?? '').trim().toLowerCase();
  if (!id) return null;
  const rows = (await sql()`
    SELECT id, name, category, role, department, is_executive, does,
           soul, agent_md, skills, default_niches, tags, richness, source, created_at
    FROM public.agent_library WHERE id = ${id}
  `) as unknown as Array<LibraryAgent & { created_at: Date }>;
  const r = rows[0];
  if (!r) return null;
  return {
    ...r,
    default_niches: r.default_niches ?? [],
    tags: r.tags ?? [],
    richness: (r.richness === 'rich' ? 'rich' : 'thin') as AgentRichness,
    created_at: new Date(r.created_at).toISOString(),
  };
}

/**
 * The agents that a given industry pre-selects at provisioning: every row whose
 * default_niches contains `nicheSlug`, PLUS the universal defaults (source =
 * 'default') and the C-suite execs (source = 'exec') that ship on every command
 * center. Light rows. This is exactly the shortlist Claude starts from when
 * standing up a new command center for that niche.
 */
export async function agentsForNiche(nicheSlug: string): Promise<LibraryAgentListItem[]> {
  const slug = String(nicheSlug ?? '').trim().toLowerCase();
  const rows = (await sql()`
    SELECT id, name, category, role, department, is_executive, does,
           default_niches, tags, richness, source
    FROM public.agent_library
    WHERE default_niches @> ARRAY[${slug}]::text[]
       OR source IN ('default', 'exec')
    ORDER BY is_executive DESC, category ASC, name ASC
  `) as unknown as RawRow[];
  return rows.map(toListItem);
}

/** Count rows grouped by source + richness — for the sales console header/QA. */
export async function libraryStats(): Promise<Array<{ source: string; richness: string; n: number }>> {
  const rows = (await sql()`
    SELECT source, richness, count(*)::int AS n
    FROM public.agent_library
    GROUP BY source, richness
    ORDER BY source, richness
  `) as unknown as Array<{ source: string; richness: string; n: number }>;
  return rows;
}
