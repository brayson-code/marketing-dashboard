import { sql, jsonb, DEFAULT_TENANT_ID } from './db/client';

export interface KgEntity {
  id: number;
  kind: string;
  name: string;
  attributes: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface KgRelation {
  id: number;
  from_id: number;
  to_id: number;
  label: string;
  attributes: Record<string, unknown>;
  created_at: Date;
}

interface EntityRow {
  id: number; kind: string; name: string; attributes: Record<string, unknown> | null;
  created_at: Date; updated_at: Date;
}
interface RelationRow {
  id: number; from_id: number; to_id: number; label: string;
  attributes: Record<string, unknown> | null; created_at: Date;
}

function hydrateEntity(r: EntityRow): KgEntity {
  return { ...r, attributes: r.attributes ?? {} };
}
function hydrateRelation(r: RelationRow): KgRelation {
  return { ...r, attributes: r.attributes ?? {} };
}

/** Provenance stamped on writes: which agent recorded the fact and how sure it is. */
export interface Provenance {
  sourceAgent?: string;
  confidence?: number;
}

/**
 * Upsert an entity by (kind, name). Returns the entity row.
 * If attributes are provided, they're merged (shallow) with existing.
 * Provenance (source_agent, confidence) is stamped on insert and refreshed on
 * re-write (last writer wins).
 */
export async function upsertEntity(
  kind: string,
  name: string,
  attributes?: Record<string, unknown>,
  prov?: Provenance,
): Promise<KgEntity> {
  const sourceAgent = prov?.sourceAgent ?? null;
  const confidence = prov?.confidence ?? 1.0;

  const existingRows = await sql()`
    SELECT * FROM kg_entities
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND kind = ${kind} AND name = ${name}
  `;
  const existing = existingRows[0] as EntityRow | undefined;

  if (existing) {
    const merged =
      attributes && Object.keys(attributes).length > 0
        ? { ...(existing.attributes ?? {}), ...attributes }
        : (existing.attributes ?? {});
    await sql()`
      UPDATE kg_entities
      SET attributes = ${jsonb(merged)},
          source_agent = ${sourceAgent},
          confidence = ${confidence},
          updated_at = now()
      WHERE id = ${existing.id} AND tenant_id = ${DEFAULT_TENANT_ID}
    `;
    return hydrateEntity({ ...existing, attributes: merged });
  }

  const inserted = await sql()`
    INSERT INTO kg_entities (tenant_id, kind, name, attributes, source_agent, confidence)
    VALUES (${DEFAULT_TENANT_ID}, ${kind}, ${name}, ${attributes ? jsonb(attributes) : null}, ${sourceAgent}, ${confidence})
    RETURNING *
  `;
  return hydrateEntity(inserted[0] as EntityRow);
}

export async function getEntityByName(kind: string, name: string): Promise<KgEntity | undefined> {
  const rows = await sql()`
    SELECT * FROM kg_entities
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND kind = ${kind} AND name = ${name}
  `;
  const r = rows[0] as EntityRow | undefined;
  return r ? hydrateEntity(r) : undefined;
}

/**
 * Create a labeled directed edge from one entity to another (idempotent on the triple).
 */
export async function link(
  from: { kind: string; name: string },
  to: { kind: string; name: string },
  label: string,
  attributes?: Record<string, unknown>,
  prov?: Provenance,
): Promise<KgRelation> {
  const sourceAgent = prov?.sourceAgent ?? null;
  const confidence = prov?.confidence ?? 1.0;

  // Endpoint entities inherit the same provenance when created as a side effect.
  const fromE = await upsertEntity(from.kind, from.name, undefined, prov);
  const toE = await upsertEntity(to.kind, to.name, undefined, prov);
  const existingRows = await sql()`
    SELECT * FROM kg_relations
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND from_id = ${fromE.id} AND to_id = ${toE.id} AND label = ${label}
  `;
  const existing = existingRows[0] as RelationRow | undefined;
  if (existing) {
    // Last writer wins: refresh provenance on the idempotent re-write.
    await sql()`
      UPDATE kg_relations
      SET source_agent = ${sourceAgent}, confidence = ${confidence}
      WHERE id = ${existing.id} AND tenant_id = ${DEFAULT_TENANT_ID}
    `;
    return hydrateRelation(existing);
  }

  const inserted = await sql()`
    INSERT INTO kg_relations (tenant_id, from_id, to_id, label, attributes, source_agent, confidence)
    VALUES (${DEFAULT_TENANT_ID}, ${fromE.id}, ${toE.id}, ${label}, ${attributes ? jsonb(attributes) : null}, ${sourceAgent}, ${confidence})
    RETURNING *
  `;
  return hydrateRelation(inserted[0] as RelationRow);
}

export async function listEntities(filters: { kind?: string; search?: string; limit?: number } = {}): Promise<KgEntity[]> {
  const limit = filters.limit ?? 200;
  const client = sql();
  const rows = await client`
    SELECT * FROM kg_entities
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
      ${filters.kind ? client`AND kind = ${filters.kind}` : client``}
      ${filters.search ? client`AND name ILIKE ${'%' + filters.search + '%'}` : client``}
    ORDER BY updated_at DESC
    LIMIT ${limit}
  `;
  return (rows as unknown as EntityRow[]).map(hydrateEntity);
}

export interface Neighbor {
  entity: KgEntity;
  relation: KgRelation;
  direction: 'out' | 'in';
}

export async function neighborsOf(entityId: number): Promise<Neighbor[]> {
  const out = await sql()`
    SELECT r.*, 'out' as direction, e.id as e_id, e.kind as e_kind, e.name as e_name, e.attributes as e_attrs, e.created_at as e_created, e.updated_at as e_updated
    FROM kg_relations r JOIN kg_entities e ON e.id = r.to_id
    WHERE r.tenant_id = ${DEFAULT_TENANT_ID} AND r.from_id = ${entityId}
  ` as unknown as Array<RelationRow & { direction: 'out'; e_id: number; e_kind: string; e_name: string; e_attrs: Record<string, unknown> | null; e_created: Date; e_updated: Date }>;
  const inn = await sql()`
    SELECT r.*, 'in' as direction, e.id as e_id, e.kind as e_kind, e.name as e_name, e.attributes as e_attrs, e.created_at as e_created, e.updated_at as e_updated
    FROM kg_relations r JOIN kg_entities e ON e.id = r.from_id
    WHERE r.tenant_id = ${DEFAULT_TENANT_ID} AND r.to_id = ${entityId}
  ` as unknown as Array<RelationRow & { direction: 'in'; e_id: number; e_kind: string; e_name: string; e_attrs: Record<string, unknown> | null; e_created: Date; e_updated: Date }>;

  return [...out, ...inn].map((r) => ({
    direction: r.direction,
    relation: hydrateRelation({ id: r.id, from_id: r.from_id, to_id: r.to_id, label: r.label, attributes: r.attributes, created_at: r.created_at }),
    entity: hydrateEntity({ id: r.e_id, kind: r.e_kind, name: r.e_name, attributes: r.e_attrs, created_at: r.e_created, updated_at: r.e_updated }),
  }));
}

export interface RememberEntityInput {
  kind: string;
  name: string;
  attributes?: Record<string, unknown>;
  /** Optional 0–1 confidence for this entity. Falls back to 1.0. */
  confidence?: number;
}

export interface RememberRelationInput {
  from: { kind: string; name: string };
  to: { kind: string; name: string };
  label: string;
  attributes?: Record<string, unknown>;
  /** Optional 0–1 confidence for this relation. Falls back to 1.0. */
  confidence?: number;
}

export interface RememberInput {
  entities?: RememberEntityInput[];
  relations?: RememberRelationInput[];
}

/**
 * Idempotently upsert a batch of entities + relations.
 * Pass `opts.sourceAgent` to stamp provenance (which agent recorded each fact);
 * per-item `confidence` overrides the 1.0 default. Backward compatible — `opts`
 * is optional and omitting it preserves the original behavior.
 */
export async function remember(
  input: RememberInput,
  opts?: { sourceAgent?: string },
): Promise<{ entities: number; relations: number }> {
  let entities = 0;
  for (const e of input.entities ?? []) {
    await upsertEntity(e.kind, e.name, e.attributes, { sourceAgent: opts?.sourceAgent, confidence: e.confidence });
    entities++;
  }
  let relations = 0;
  for (const r of input.relations ?? []) {
    await link(r.from, r.to, r.label, r.attributes, { sourceAgent: opts?.sourceAgent, confidence: r.confidence });
    relations++;
  }
  return { entities, relations };
}
