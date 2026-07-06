// Knowledge-graph retrieval bridge — turns the write-mostly KG into always-on,
// RAG-style PERSISTENT MEMORY for every agent run.
//
// Until now the KG (kg_entities + kg_relations) was write-mostly: agents only saw
// a fact if they *chose* to call the kg_query tool, which they rarely did. This
// module injects a bounded "Relevant memory" block into every orchestrator + sub-
// agent prompt so durable facts are recalled automatically — the agent reuses what
// we already know instead of re-asking.
//
// Retrieval is STRUCTURED (no embeddings/vectors exist yet): retrieve-then-
// traverse. When we have query text we (a) KEYWORD-match entities via Postgres
// full-text (kg_entities.search_tsv @@ websearch_to_tsquery, ranked by
// ts_rank_cd — see migration 0055), (b) GRAPH-TRAVERSE 1 hop out to their
// neighbors over kg_relations so a mention of "Acme" also pulls Acme's connected
// contacts/deals, then (c) a recency+confidence FILL query tops up the remaining
// slots (and covers the no-query case entirely). Finally ONE relations query
// renders edges for the selected ids. Everything is tenant-scoped via tenantId()
// (sql() bypasses RLS). Strict char ceiling + return '' when the KG is empty →
// zero prompt/token cost when unused. Never throws — a memory-load failure must
// NEVER break an agent run.

import { sql, tenantId } from './db/client';

// Strict ceiling for the WHOLE returned block (header + entries + omitted-note),
// mirroring knowledge-context.ts. Newest/most-relevant first; stop when full.
const BUDGET_CHARS = 3500;
const HEADER =
  '# Relevant memory (facts we already know — recall and use these; do not re-ask)\n\n';
const OMITTED_NOTE = '\n\n_(additional remembered facts omitted for length)_';
const JOINER = '\n'; // one line between entity bullets

// Bounds (no unbounded N+1 anywhere). Candidate selection is a CONSTANT number of
// queries: keyword-retrieve + traverse-edges + load-neighbors + recency fill, then
// ONE edge-render relations query downstream. The keyword pass returns at most
// KEYWORD_LIMIT primary matches; each is expanded by at most NEIGHBORS_PER_MATCHED
// neighbors, capped at NEIGHBOR_TOTAL_CAP overall; the fill query loads at most
// CANDIDATE_LIMIT entities. We render at most MAX_ENTITIES of the merged set, with
// at most MAX_RELATIONS_PER_ENTITY edges each and MAX_RELATIONS_TOTAL edges overall.
const KEYWORD_LIMIT = 30; // primary full-text matches
const NEIGHBORS_PER_MATCHED = 2; // 1-hop expansion per matched entity
const NEIGHBOR_TOTAL_CAP = 24; // overall neighbor budget (keeps the set small)
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
 * user message) drives keyword retrieval + 1-hop graph traversal (matched entities
 * and their neighbors come first); when omitted we fall back to the top-confidence,
 * most-recent facts. Returns '' when the KG is empty or nothing fits. Best-effort:
 * any failure resolves to '' so it can never break a run.
 */
export async function relevantMemoryBlock(queryText?: string): Promise<string> {
  try {
    // ── Candidate selection: retrieve-then-traverse (constant query count) ──────
    const q = (queryText ?? '').trim();

    // (a) KEYWORD retrieve — primary matches via Postgres full-text (migration
    //     0055). Only when q is non-empty; a stopword-only q simply yields 0 rows.
    let keywordRows: CandidateRow[] = [];
    if (q) {
      try {
        keywordRows = (await sql()`
          SELECT id, kind, name, attributes, confidence, updated_at
          FROM public.kg_entities
          WHERE tenant_id = ${tenantId()}
            AND search_tsv @@ websearch_to_tsquery('english', ${q})
          ORDER BY ts_rank_cd(search_tsv, websearch_to_tsquery('english', ${q})) DESC,
                   updated_at DESC
          LIMIT ${KEYWORD_LIMIT}
        `) as unknown as CandidateRow[];
      } catch {
        // Keyword retrieval is additive: if the full-text column/index isn't available
        // yet (e.g. code deployed before migration 0055), degrade to the recency+
        // confidence fill below instead of nuking the whole memory block.
        keywordRows = [];
      }
    }

    // (b) GRAPH TRAVERSE (1-hop) — expand the matched entities to their neighbors
    //     so a message about "Acme" also pulls Acme's connected contacts/deals.
    //     TWO bounded queries total (edges, then neighbor entities) — NOT per
    //     entity. ids passed as bound bigint[] params, never string-interpolated.
    let neighborRows: CandidateRow[] = [];
    if (keywordRows.length) {
      const matchedIds = keywordRows.map((r) => Number(r.id));
      const matchedSet = new Set(matchedIds);
      try {
        const edges = (await sql()`
          SELECT from_id, to_id
          FROM public.kg_relations
          WHERE tenant_id = ${tenantId()}
            AND (from_id = ANY(${matchedIds}::bigint[]) OR to_id = ANY(${matchedIds}::bigint[]))
          ORDER BY COALESCE(confidence, 1.0) DESC, created_at DESC
          LIMIT 400
        `) as unknown as { from_id: number | string; to_id: number | string }[];

        // Collect neighbor ids, ≤ NEIGHBORS_PER_MATCHED per matched anchor and
        // ≤ NEIGHBOR_TOTAL_CAP overall, skipping ids already matched by keyword.
        const perMatched = new Map<number, number>();
        const seenNeighbor = new Set<number>();
        const neighborIds: number[] = [];
        for (const e of edges) {
          if (neighborIds.length >= NEIGHBOR_TOTAL_CAP) break;
          const from = Number(e.from_id);
          const to = Number(e.to_id);
          const anchor = matchedSet.has(from) ? from : matchedSet.has(to) ? to : null;
          if (anchor === null) continue;
          const neighbor = anchor === from ? to : from;
          if (matchedSet.has(neighbor) || seenNeighbor.has(neighbor)) continue;
          if ((perMatched.get(anchor) ?? 0) >= NEIGHBORS_PER_MATCHED) continue;
          perMatched.set(anchor, (perMatched.get(anchor) ?? 0) + 1);
          seenNeighbor.add(neighbor);
          neighborIds.push(neighbor);
        }

        if (neighborIds.length) {
          neighborRows = (await sql()`
            SELECT id, kind, name, attributes, confidence, updated_at
            FROM public.kg_entities
            WHERE tenant_id = ${tenantId()}
              AND id = ANY(${neighborIds}::bigint[])
          `) as unknown as CandidateRow[];
        }
      } catch {
        // Traversal is additive — a failure just yields keyword matches without neighbors.
      }
    }

    // (c) FALLBACK / FILL (always) — the existing recency+confidence query. Tops up
    //     remaining slots with entities not already selected, and covers the
    //     no-queryText case entirely (pure top-confidence/recent, exactly as before).
    const fillRows = (await sql()`
      SELECT id, kind, name, attributes, confidence, updated_at
      FROM public.kg_entities
      WHERE tenant_id = ${tenantId()}
      ORDER BY COALESCE(confidence, 1.0) DESC, updated_at DESC
      LIMIT ${CANDIDATE_LIMIT}
    `) as unknown as CandidateRow[];

    // (d) MERGE + ORDER — dedupe by id; keyword matches first, then their neighbors,
    //     then the recency/confidence fill. Score each for the fill ordering / the
    //     existing renderer; recency is normalized across the whole gathered set, so
    //     with no query text (fill only) scoring is identical to before.
    const allRows = [...keywordRows, ...neighborRows, ...fillRows];
    if (!allRows.length) return ''; // zero cost when the KG is empty

    const times = allRows.map((c) => toMs(c.updated_at));
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const span = maxT - minT;

    const mkScored = (c: CandidateRow): Scored => {
      const conf = Math.min(Math.max(c.confidence ?? 1, 0), 1);
      const recency = span > 0 ? (toMs(c.updated_at) - minT) / span : 1;
      return {
        id: Number(c.id),
        kind: c.kind,
        name: c.name,
        attributes: c.attributes,
        confidence: conf,
        score: conf * 0.6 + recency * 0.4,
        mentioned: q ? isMentioned(c.name, q) : false,
      };
    };

    const keywordScored = keywordRows.map(mkScored); // keep ts_rank order
    const neighborScored = neighborRows.map(mkScored); // keep traversal order
    // Fill matches the previous behavior: top-confidence/recent, sorted by score.
    const fillScored = fillRows.map(mkScored).sort((a, b) => b.score - a.score);

    const selected: Scored[] = [];
    const selectedIds = new Set<number>();
    for (const group of [keywordScored, neighborScored, fillScored]) {
      for (const s of group) {
        if (selected.length >= MAX_ENTITIES) break;
        if (selectedIds.has(s.id)) continue;
        selectedIds.add(s.id);
        selected.push(s);
      }
      if (selected.length >= MAX_ENTITIES) break;
    }
    if (!selected.length) return '';

    const ids = selected.map((s) => s.id);

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
        LIMIT 400
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
