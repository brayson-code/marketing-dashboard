// Knowledge-graph retrieval bridge — turns the write-mostly KG into always-on,
// RAG-style PERSISTENT MEMORY for every agent run.
//
// Until now the KG (kg_entities + kg_relations) was write-mostly: agents only saw
// a fact if they *chose* to call the kg_query tool, which they rarely did. This
// module injects a bounded "Relevant memory" block into every orchestrator + sub-
// agent prompt so durable facts are recalled automatically — the agent reuses what
// we already know instead of re-asking.
//
// Retrieval is STRUCTURED (no embeddings/vectors exist yet): a single bounded
// candidate query (recency + confidence), an optional entity-name mention match
// against the run's query text, then ONE relations query for the selected ids.
// Everything is tenant-scoped via tenantId() (sql() bypasses RLS). Strict char
// ceiling + return '' when the KG is empty → zero prompt/token cost when unused.
// Never throws — a memory-load failure must NEVER break an agent run.

import { sql, tenantId } from './db/client';

// Strict ceiling for the WHOLE returned block (header + entries + omitted-note),
// mirroring knowledge-context.ts. Newest/most-relevant first; stop when full.
const BUDGET_CHARS = 3500;
const HEADER =
  '# Relevant memory (facts we already know — recall and use these; do not re-ask)\n\n';
const OMITTED_NOTE = '\n\n_(additional remembered facts omitted for length)_';
const JOINER = '\n'; // one line between entity bullets

// Bounds (no unbounded N+1 anywhere): one query loads at most CANDIDATE_LIMIT
// entities; we render at most MAX_ENTITIES of them, with at most
// MAX_RELATIONS_PER_ENTITY edges each and MAX_RELATIONS_TOTAL edges overall.
const CANDIDATE_LIMIT = 60;
const MAX_ENTITIES = 12;
const MAX_RELATIONS_TOTAL = 40;
const MAX_RELATIONS_PER_ENTITY = 5;
const LOW_CONFIDENCE = 0.6; // below this an entity is flagged "(unconfirmed)"
const ATTRS_MAX_CHARS = 180; // per-entity attribute summary cap

interface CandidateRow {
  id: number | string;
  kind: string;
  name: string;
  attributes: Record<string, unknown> | null;
  confidence: number | null;
  updated_at: string | Date;
}

interface RelationJoinRow {
  from_id: number | string;
  to_id: number | string;
  label: string;
  from_kind: string;
  from_name: string;
  to_kind: string;
  to_name: string;
}

interface Scored {
  id: number;
  kind: string;
  name: string;
  attributes: Record<string, unknown> | null;
  confidence: number;
  score: number;
  mentioned: boolean;
}

function toMs(v: string | Date): number {
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isFinite(t) ? t : 0;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Word-ish, case-insensitive: does the entity `name` appear as a token in `q`? */
function isMentioned(name: string, q: string): boolean {
  const n = name.trim();
  if (n.length < 2) return false; // too short to match reliably
  try {
    // Boundaries on non-letter/non-digit (Unicode-aware) so "AI" doesn't match "brain".
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(n)}([^\\p{L}\\p{N}]|$)`, 'iu');
    return re.test(q);
  } catch {
    return q.toLowerCase().includes(n.toLowerCase());
  }
}

/** Compact one-line summary of an entity's attributes; '' when empty/none usable. */
function summarizeAttrs(attrs: Record<string, unknown> | null): string {
  if (!attrs) return '';
  const bits: string[] = [];
  for (const k of Object.keys(attrs)) {
    const v = attrs[k];
    if (v === null || v === undefined || v === '') continue;
    let s: string;
    if (typeof v === 'string') s = v;
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v);
    else {
      try { s = JSON.stringify(v); } catch { continue; }
    }
    s = s.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    if (s.length > 60) s = `${s.slice(0, 57)}…`;
    bits.push(`${k}: ${s}`);
    if (bits.join(', ').length >= ATTRS_MAX_CHARS) break;
  }
  let out = bits.join(', ');
  if (out.length > ATTRS_MAX_CHARS) out = `${out.slice(0, ATTRS_MAX_CHARS - 1)}…`;
  return out;
}

/**
 * A ready-to-inject "Relevant memory" system-prompt block built from the tenant's
 * knowledge graph, tenant-scoped and bounded. `queryText` (the run's task / latest
 * user message) biases selection toward entities named in it; when omitted we fall
 * back to the top-confidence, most-recent facts. Returns '' when the KG is empty or
 * nothing fits. Best-effort: any failure resolves to '' so it can never break a run.
 */
export async function relevantMemoryBlock(queryText?: string): Promise<string> {
  try {
    // 1) Candidate set — ONE bounded query (recency + confidence). Cap at 60.
    const candidates = (await sql()`
      SELECT id, kind, name, attributes, confidence, updated_at
      FROM public.kg_entities
      WHERE tenant_id = ${tenantId()}
      ORDER BY COALESCE(confidence, 1.0) DESC, updated_at DESC
      LIMIT ${CANDIDATE_LIMIT}
    `) as unknown as CandidateRow[];

    if (!candidates.length) return ''; // zero cost when the KG is empty

    // 2) Score = confidence*0.6 + recency*0.4 (recency normalized across candidates,
    //    newer → higher). Entities whose name is mentioned in queryText are flagged.
    const times = candidates.map((c) => toMs(c.updated_at));
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = maxT - minT;
    const q = (queryText ?? '').trim();

    const scored: Scored[] = candidates.map((c, i) => {
      const conf = Math.min(Math.max(c.confidence ?? 1, 0), 1);
      const recency = span > 0 ? (times[i] - minT) / span : 1;
      return {
        id: Number(c.id),
        kind: c.kind,
        name: c.name,
        attributes: c.attributes,
        confidence: conf,
        score: conf * 0.6 + recency * 0.4,
        mentioned: q ? isMentioned(c.name, q) : false,
      };
    });

    // Mentioned first (highest priority), then fill by score; at most MAX_ENTITIES.
    const mentioned = scored.filter((s) => s.mentioned).sort((a, b) => b.score - a.score);
    const rest = scored.filter((s) => !s.mentioned).sort((a, b) => b.score - a.score);
    const selected = [...mentioned, ...rest].slice(0, MAX_ENTITIES);
    if (!selected.length) return '';

    const ids = selected.map((s) => s.id);
    const selectedIds = new Set(ids);

    // 3) Relations for the selected ids — ONE query (not per-entity). ids are passed
    //    as a safe array param (never string-interpolated) and cast to bigint[].
    const relByEntity = new Map<number, string[]>();
    try {
      const relRows = (await sql()`
        SELECT r.from_id, r.to_id, r.label,
               ef.kind AS from_kind, ef.name AS from_name,
               et.kind AS to_kind,   et.name AS to_name
        FROM public.kg_relations r
        JOIN public.kg_entities ef ON ef.id = r.from_id AND ef.tenant_id = ${tenantId()}
        JOIN public.kg_entities et ON et.id = r.to_id  AND et.tenant_id = ${tenantId()}
        WHERE r.tenant_id = ${tenantId()}
          AND (r.from_id = ANY(${ids}::bigint[]) OR r.to_id = ANY(${ids}::bigint[]))
        ORDER BY COALESCE(r.confidence, 1.0) DESC, r.created_at DESC
      `) as unknown as RelationJoinRow[];

      let totalRel = 0;
      for (const r of relRows) {
        if (totalRel >= MAX_RELATIONS_TOTAL) break;
        const fromId = Number(r.from_id);
        const toId = Number(r.to_id);
        // Outgoing edge (a selected entity is the source).
        if (selectedIds.has(fromId)) {
          const list = relByEntity.get(fromId) ?? [];
          if (list.length < MAX_RELATIONS_PER_ENTITY) {
            list.push(`  · ${r.label} → ${r.to_kind}:${r.to_name}`);
            relByEntity.set(fromId, list);
            totalRel++;
          }
        }
        if (totalRel >= MAX_RELATIONS_TOTAL) break;
        // Incoming edge (a selected entity is the target) — arrow reversed so the
        // recorded direction stays truthful.
        if (selectedIds.has(toId)) {
          const list = relByEntity.get(toId) ?? [];
          if (list.length < MAX_RELATIONS_PER_ENTITY) {
            list.push(`  · ${r.label} ← ${r.from_kind}:${r.from_name}`);
            relByEntity.set(toId, list);
            totalRel++;
          }
        }
      }
    } catch {
      // Relations are additive — a failure here just yields entities without edges.
    }

    // 4) Format, honoring the strict char ceiling (reserve the omitted-note like
    //    knowledge-context.ts; count the joiner between bullets).
    const parts: string[] = [];
    let used = HEADER.length;
    let skipped = false;

    for (let i = 0; i < selected.length; i++) {
      const s = selected[i];
      const joiner = parts.length ? JOINER.length : 0;
      const remaining = BUDGET_CHARS - used - OMITTED_NOTE.length;
      if (remaining - joiner <= 0) { skipped = true; break; }

      const attrs = summarizeAttrs(s.attributes);
      const flag = s.confidence < LOW_CONFIDENCE ? ' (unconfirmed)' : '';
      // Cap the name so a pathologically long entity name truncates rather than
      // overflowing `remaining` and getting silently dropped.
      const name = s.name.length > 120 ? `${s.name.slice(0, 119)}…` : s.name;
      const head = `- **${s.kind}: ${name}**${flag}${attrs ? ` — ${attrs}` : ''}`;
      const rels = relByEntity.get(s.id) ?? [];
      const full = rels.length ? `${head}\n${rels.join('\n')}` : head;

      if (joiner + full.length <= remaining) {
        parts.push(full);
        used += joiner + full.length;
        continue;
      }
      // Full entry overflows — salvage the header-only line if it fits, then stop.
      if (joiner + head.length <= remaining) {
        parts.push(head);
        used += joiner + head.length;
      }
      skipped = true;
      break;
    }

    if (!parts.length) return '';

    let block = HEADER + parts.join(JOINER);
    if (skipped || parts.length < selected.length) block += OMITTED_NOTE;
    return block;
  } catch {
    // Never let a memory-load failure break an agent run.
    return '';
  }
}
