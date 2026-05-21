// Shared knowledge-graph tools. ONE definition used by the orchestrator AND
// every sub-agent so the whole team writes into the same graph with a
// controlled ontology and stamped provenance (which agent recorded a fact +
// how confident it was).
//
// - `kgToolDefinitions()` returns the Anthropic tool defs (kg_query, kg_remember).
// - `handleKgTool()` executes either tool and stamps `source_agent`/`confidence`.
import Anthropic from '@anthropic-ai/sdk';
import {
  remember as kgRemember,
  listEntities as kgListEntities,
  getEntityByName as kgGetEntity,
  neighborsOf as kgNeighborsOf,
  type RememberInput,
} from './kg';

// ── Controlled ontology ──────────────────────────────────────────────────────
// Agents must reuse these — pick the closest existing kind/label rather than
// inventing new ones, so the graph stays queryable and consistent.
export const KG_ENTITY_KINDS = [
  'person', 'company', 'product', 'topic', 'lead', 'goal', 'content', 'channel',
  'campaign', 'agent', 'event', 'metric', 'document', 'project', 'tool',
] as const;

export const KG_RELATION_LABELS = [
  'works_at', 'founded', 'competes_with', 'partners_with', 'owns', 'uses',
  'mentions', 'targets', 'member_of', 'created_by', 'related_to', 'part_of',
  'located_in', 'reports_to', 'scheduled_for', 'resulted_in', 'depends_on',
] as const;

export type KgEntityKind = (typeof KG_ENTITY_KINDS)[number];
export type KgRelationLabel = (typeof KG_RELATION_LABELS)[number];

/**
 * The shared kg_query + kg_remember tool definitions. Spread these into any
 * agent's `tools` array (`...kgToolDefinitions()`).
 */
export function kgToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'kg_remember',
      description:
        'Record entities (people, companies, topics, leads, products, …) and relationships between them in the shared long-term knowledge graph. Use as you learn material facts — "X works at Y", "topic A is related to topic B", "campaign C targets lead D" — so the rest of the team (and future turns) can reuse them without re-searching. Idempotent on (kind, name) for entities and (from, to, label) for relations.\n\n' +
        'ONTOLOGY — use ONLY these values; pick the closest existing one, do NOT invent new kinds or labels (a consistent graph stays queryable):\n' +
        `- entity \`kind\`: ${KG_ENTITY_KINDS.join(', ')}\n` +
        `- relation \`label\`: ${KG_RELATION_LABELS.join(', ')}\n\n` +
        'Optionally include a `confidence` (0–1) on any entity or relation to say how sure you are.',
      input_schema: {
        type: 'object',
        properties: {
          entities: {
            type: 'array',
            description: 'Entities to upsert. Use a `kind` from the allowed ontology list above.',
            items: {
              type: 'object',
              properties: {
                kind: { type: 'string', enum: [...KG_ENTITY_KINDS], description: 'One of the allowed entity kinds.' },
                name: { type: 'string' },
                attributes: { type: 'object', additionalProperties: true, description: 'Optional structured attributes (role, url, stage, etc.).' },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Optional 0–1 confidence in this fact.' },
              },
              required: ['kind', 'name'],
            },
          },
          relations: {
            type: 'array',
            description: 'Directed labeled edges from→to. Use a `label` from the allowed ontology list above.',
            items: {
              type: 'object',
              properties: {
                from: { type: 'object', properties: { kind: { type: 'string', enum: [...KG_ENTITY_KINDS] }, name: { type: 'string' } }, required: ['kind', 'name'] },
                to: { type: 'object', properties: { kind: { type: 'string', enum: [...KG_ENTITY_KINDS] }, name: { type: 'string' } }, required: ['kind', 'name'] },
                label: { type: 'string', enum: [...KG_RELATION_LABELS], description: 'One of the allowed relation labels.' },
                attributes: { type: 'object', additionalProperties: true },
                confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Optional 0–1 confidence in this relationship.' },
              },
              required: ['from', 'to', 'label'],
            },
          },
        },
      },
    },
    {
      name: 'kg_query',
      description: 'Look up what is known about an entity by name (and optional kind). Returns the entity attributes plus its connections — both inbound and outbound. Use before doing fresh research to avoid re-finding things the team already knows.',
      input_schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', description: 'Optional kind filter to disambiguate.' },
        },
        required: ['name'],
      },
    },
  ];
}

/**
 * Execute a kg_query / kg_remember tool_use and return a tool_result block.
 * Stamps provenance: writes set `source_agent = sourceAgent` and per-item
 * `confidence` (default 1.0). Unknown tool names return an error result.
 */
export async function handleKgTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent: string,
): Promise<Anthropic.ToolResultBlockParam> {
  if (toolUse.name === 'kg_remember') {
    try {
      const result = await kgRemember(toolUse.input as RememberInput, { sourceAgent });
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Recorded ${result.entities} entities and ${result.relations} relations.` };
    } catch (err) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${(err as Error).message}`, is_error: true };
    }
  }

  if (toolUse.name === 'kg_query') {
    const input = toolUse.input as { name?: string; kind?: string };
    if (!input.name) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: 'Error: name is required.', is_error: true };
    }
    try {
      // Find by exact (kind, name) if kind given, else search by name.
      const exact = input.kind ? await kgGetEntity(input.kind, input.name) : null;
      const matches = exact ? [exact] : await kgListEntities({ search: input.name, limit: 5 });
      if (matches.length === 0) {
        return { type: 'tool_result', tool_use_id: toolUse.id, content: `Nothing known about "${input.name}" yet.` };
      }
      const out = (await Promise.all(matches.map(async (e) => {
        const nbrs = await kgNeighborsOf(e.id);
        const nbrLines = nbrs.slice(0, 20).map((n) => {
          const arrow = n.direction === 'out' ? '→' : '←';
          return `  ${arrow} ${n.relation.label} ${arrow} ${n.entity.kind}:${n.entity.name}`;
        }).join('\n');
        return `[${e.kind}] ${e.name}\n  attrs: ${JSON.stringify(e.attributes)}\n  connections (${nbrs.length}):\n${nbrLines || '  (none)'}`;
      }))).join('\n\n');
      return { type: 'tool_result', tool_use_id: toolUse.id, content: out };
    } catch (err) {
      return { type: 'tool_result', tool_use_id: toolUse.id, content: `Error: ${(err as Error).message}`, is_error: true };
    }
  }

  return {
    type: 'tool_result',
    tool_use_id: toolUse.id,
    content: `Error: unknown KG tool ${toolUse.name}`,
    is_error: true,
  };
}
