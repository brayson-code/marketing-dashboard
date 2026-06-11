// recall_skill tool — pull a specific skill/playbook by name on demand, instead
// of baking every skill into the system prompt at spawn time. Any sub-agent can
// call this mid-run when it's about to attempt an unfamiliar tactic.
//
// Lookup order:
//   1. KG entities (kind = 'skill') — preferred, content + tags live in `attributes`.
//   2. agent_defs.skills fallback — search the markdown skills column on each
//      agent def. Returns excerpts so the caller still gets something useful.
//
// Never throws — on miss, returns a friendly "no skill found" string so the
// sub-agent can decide to ask the orchestrator or draft its own approach.
import Anthropic from '@anthropic-ai/sdk';
import { sql, tenantId } from './db/client';

interface SkillKgRow {
  id: number;
  name: string;
  attributes: Record<string, unknown> | null;
}

interface SkillDefRow {
  id: string;
  skills: string;
}

export function skillRecallToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'recall_skill',
      description:
        'Retrieve a specific skill or technique by name when you need a step-by-step playbook mid-task. Use this BEFORE attempting an unfamiliar tactic — do not invent the playbook. The tool returns the skill content as markdown.',
      input_schema: {
        type: 'object',
        required: ['query'],
        properties: {
          query: {
            type: 'string',
            description:
              'A short phrase describing the skill you need (e.g. "linkedin carousel post structure", "cold outreach opening lines", "youtube thumbnail composition").',
          },
          limit: {
            type: 'integer',
            default: 1,
            minimum: 1,
            maximum: 3,
          },
        },
      },
    },
  ];
}

function clampLimit(raw: unknown): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n)) return 1;
  return Math.max(1, Math.min(3, n));
}

function extractContent(attrs: Record<string, unknown> | null): string {
  if (!attrs) return '';
  const c = attrs.content;
  return typeof c === 'string' ? c : '';
}

export async function handleSkillRecallTool(
  toolUse: Anthropic.ToolUseBlock,
  _sourceAgentId: string,
): Promise<Anthropic.ToolResultBlockParam> {
  try {
    const input = (toolUse.input ?? {}) as { query?: unknown; limit?: unknown };
    const query = String(input.query ?? '').trim();
    if (!query) {
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: 'Error: query is required.',
        is_error: true,
      };
    }
    const limit = clampLimit(input.limit);
    const like = `%${query}%`;

    // Source 1: KG — kg_entities rows where kind='skill'. Match on the entity name
    // OR on tags stored in the jsonb attributes (attributes.tags is a string[]).
    const kgRows = (await sql()`
      SELECT id, name, attributes
      FROM public.kg_entities
      WHERE tenant_id = ${tenantId()}
        AND kind = 'skill'
        AND (
          name ILIKE ${like}
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(
              COALESCE(attributes->'tags', '[]'::jsonb)
            ) tag WHERE tag ILIKE ${like}
          )
        )
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `) as unknown as SkillKgRow[];

    if (kgRows.length > 0) {
      const sections = kgRows.map((r) => {
        const body = extractContent(r.attributes) || '_(no content stored)_';
        return `# Skill: ${r.name}\n${body}`;
      });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: sections.join('\n\n'),
      };
    }

    // Source 2: agent_defs.skills fallback. Pull short excerpts around the match
    // so the caller still gets a usable hint when no KG skill exists yet.
    const defRows = (await sql()`
      SELECT id, skills
      FROM public.agent_defs
      WHERE tenant_id = ${tenantId()}
        AND skills ILIKE ${like}
      ORDER BY id
      LIMIT ${limit}
    `) as unknown as SkillDefRow[];

    if (defRows.length > 0) {
      const sections = defRows.map((r) => {
        const text = r.skills ?? '';
        const idx = text.toLowerCase().indexOf(query.toLowerCase());
        let excerpt = text;
        if (idx >= 0) {
          const start = Math.max(0, idx - 400);
          const end = Math.min(text.length, idx + 800);
          excerpt = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
        } else {
          excerpt = text.slice(0, 1200);
        }
        return `# Skill: ${r.id} (agent skills excerpt)\n${excerpt}`;
      });
      return {
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: sections.join('\n\n'),
      };
    }

    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `No skill found for query: ${query}. Consider drafting your own approach or asking the orchestrator for guidance.`,
    };
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: `Skill recall failed: ${(err as Error).message}`,
      is_error: true,
    };
  }
}
