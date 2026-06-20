// reanalyze.ts — Playbook Studio (Phase 2): the MANUAL "re-derive the active playbook from
// evidence" step. reanalyzePlaybook(activeContent, sources) reads the tenant's CURRENT active
// PlaybookContent + a set of extracted sources (own won calls, creator IG teardowns, pasted
// YouTube/notes) and proposes a CHANGE-SET: a list of typed, CITED, confidence-rated changes
// to specific PlaybookContent fields. It NEVER mutates a playbook — it only emits the diff. The
// reanalyze route stages this as a salesops_playbook_changesets row (status 'pending'); applying
// it goes through the same non-destructive path as playbook/apply.
//
// Same BYO-key + tool-forced Anthropic pattern as playbook-gen.ts: ONE `emit_changeset` tool,
// tool_choice forcing it, read off the tool_use block, then NORMALIZE/CLAMP defensively:
//   - drop any change whose `field` is not one of the 12 PlaybookContent keys
//   - drop any change whose `proposed_value` type doesn't match that field's type
//     (string vs string[] vs the {objection,response}[] array)
//   - drop any change with ZERO citations (every change MUST cite >=1 provided source)
//   - coerce `op` to 'replace'|'append' and `confidence` to 'high'|'medium'|'low'
// The PATTERN-CONFIDENCE rule is baked into the system prompt: a change supported by a SINGLE
// source must be confidence:'low' (with pattern_support saying so); prefer corroborated changes;
// never invent pricing/facts not present in the sources or the current playbook.
//
// BYO key: getAnthropicKey() missing → throw Error(CONNECT_ANTHROPIC). The route maps that to
// 400 {error:'connect_anthropic'}; any other provider/parse failure throws a generic message
// the route maps to 502 {error:'reanalyze_failed'}.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/anthropic-key';
import {
  CONNECT_ANTHROPIC,
  type PlaybookContent,
  type ObjectionScript,
} from '@/lib/salesops/playbook-gen';
import type { SourceRecord } from '@/lib/salesops/sources';

// Mirrors the model used by the shipped SalesOps routes + playbook-gen.
const REANALYZE_MODEL = 'claude-sonnet-4-5';

// The 12 PlaybookContent keys a change may target, with their value kinds. This is the single
// source of truth the normalizer uses to reject unknown fields + type-mismatched values.
type FieldKind = 'text' | 'string_list' | 'objection_list';

export const PLAYBOOK_FIELD_KINDS: Record<keyof PlaybookContent, FieldKind> = {
  persona: 'text',
  company_name: 'text',
  product_name: 'text',
  pricing: 'text',
  differentiators: 'text',
  objection_keywords: 'string_list',
  opener: 'text',
  discovery_questions: 'string_list',
  value_props: 'string_list',
  objection_handling: 'objection_list',
  closing: 'text',
  playbook_narrative: 'text',
};

const PLAYBOOK_FIELDS = Object.keys(PLAYBOOK_FIELD_KINDS) as (keyof PlaybookContent)[];

export type ChangeOp = 'replace' | 'append';
export type ChangeConfidence = 'high' | 'medium' | 'low';

/** A citation: a quote drawn from ONE of the provided sources, with that source's id + label. */
export interface ChangeCitation {
  source_id: string;
  source_label: string;
  quote: string;
}

/** One proposed change to a single PlaybookContent field. `proposed_value`'s runtime type
 *  matches that field's kind: string (text), string[] (string_list), or ObjectionScript[]
 *  (objection_list). Every change cites >=1 provided source. */
export interface ChangeItem {
  field: keyof PlaybookContent;
  op: ChangeOp;
  current_excerpt: string;
  proposed_value: string | string[] | ObjectionScript[];
  rationale: string;
  confidence: ChangeConfidence;
  pattern_support: string; // reflects MULTIPLE sources, e.g. "appears in 4 of 6 sources"
  citations: ChangeCitation[];
}

/** The model's emitted change-set (pre-persistence). The route wraps this into a
 *  salesops_playbook_changesets row (status 'pending', base_playbook_id, sources_used). */
export interface ChangeSet {
  summary: string;
  changes: ChangeItem[];
}

// ── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

function strArray(v: unknown, cap: number): string[] {
  let arr: unknown[];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(/[,\n]/);
  else return [];
  return arr.map((x) => str(x)).filter(Boolean).slice(0, cap);
}

function objectionScripts(v: unknown, cap: number): ObjectionScript[] {
  if (!Array.isArray(v)) return [];
  const out: ObjectionScript[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const objection = str((item as Record<string, unknown>).objection);
      const response = str((item as Record<string, unknown>).response);
      if (objection || response) out.push({ objection, response });
    }
    if (out.length >= cap) break;
  }
  return out;
}

function coerceOp(v: unknown): ChangeOp {
  return v === 'append' ? 'append' : 'replace';
}

function coerceConfidence(v: unknown): ChangeConfidence {
  return v === 'high' || v === 'low' ? v : 'medium';
}

function isPlaybookField(v: unknown): v is keyof PlaybookContent {
  return typeof v === 'string' && (PLAYBOOK_FIELDS as string[]).includes(v);
}

/** Per-field caps mirror playbook-gen / apply so a proposed list can't exceed the snapshot's. */
const LIST_CAPS: Record<string, number> = {
  objection_keywords: 24,
  discovery_questions: 12,
  value_props: 10,
  objection_handling: 16,
};

/** Coerce a raw proposed_value to the field's declared runtime type, or null if it can't be
 *  coerced to a non-empty value of that type (→ the change is dropped). */
function coerceProposedValue(
  field: keyof PlaybookContent,
  raw: unknown,
): string | string[] | ObjectionScript[] | null {
  const kind = PLAYBOOK_FIELD_KINDS[field];
  if (kind === 'text') {
    const s = str(raw);
    return s ? s : null;
  }
  if (kind === 'string_list') {
    const cap = LIST_CAPS[field] ?? 24;
    let list = strArray(raw, cap);
    if (field === 'objection_keywords') list = list.map((k) => k.toLowerCase());
    return list.length ? list : null;
  }
  // objection_list
  const scripts = objectionScripts(raw, LIST_CAPS.objection_handling);
  return scripts.length ? scripts : null;
}

/** Keep only citations that reference one of the provided source ids and carry a non-empty
 *  quote. We re-map the label off the trusted source set (don't trust the model's label). */
function normalizeCitations(raw: unknown, sourceById: Map<string, SourceRecord>): ChangeCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: ChangeCitation[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const r = c as Record<string, unknown>;
    const sourceId = str(r.source_id);
    const quote = str(r.quote);
    const src = sourceById.get(sourceId);
    if (!src || !quote) continue; // must cite a REAL provided source + carry a quote
    out.push({
      source_id: sourceId,
      source_label: sourceLabel(src),
      quote: quote.slice(0, 600),
    });
  }
  return out;
}

/** A stable display label for a source (falls back across label → handle/ref → kind). */
function sourceLabel(s: SourceRecord): string {
  return str(s.label) || str(s.ref) || s.kind;
}

/** Normalize ONE raw change item; returns null to drop it (unknown field, type mismatch, or
 *  zero valid citations). */
function normalizeChange(
  raw: unknown,
  sourceById: Map<string, SourceRecord>,
): ChangeItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const field = r.field;
  if (!isPlaybookField(field)) return null; // unknown field → drop

  const proposed_value = coerceProposedValue(field, r.proposed_value);
  if (proposed_value === null) return null; // type mismatch / empty → drop

  const citations = normalizeCitations(r.citations, sourceById);
  if (citations.length === 0) return null; // uncited → drop

  return {
    field,
    op: coerceOp(r.op),
    current_excerpt: str(r.current_excerpt).slice(0, 600),
    proposed_value,
    rationale: str(r.rationale).slice(0, 800),
    confidence: coerceConfidence(r.confidence),
    pattern_support: str(r.pattern_support).slice(0, 200),
    citations,
  };
}

// ── rendering the model input ──────────────────────────────────────────────────

/** Render the current active playbook so the model can see what it's revising. */
function renderActivePlaybook(c: PlaybookContent): string {
  const list = (xs: string[]) => (xs.length ? xs.map((x) => `  - ${x}`).join('\n') : '  (none)');
  const objs = (xs: ObjectionScript[]) =>
    xs.length ? xs.map((o) => `  - "${o.objection}" → ${o.response}`).join('\n') : '  (none)';
  return [
    '# CURRENT ACTIVE PLAYBOOK (the thing you are revising)',
    `persona: ${c.persona || '(empty)'}`,
    `company_name: ${c.company_name || '(empty)'}`,
    `product_name: ${c.product_name || '(empty)'}`,
    `pricing: ${c.pricing || '(empty)'}`,
    `differentiators: ${c.differentiators || '(empty)'}`,
    `objection_keywords:\n${list(c.objection_keywords)}`,
    `opener: ${c.opener || '(empty)'}`,
    `discovery_questions:\n${list(c.discovery_questions)}`,
    `value_props:\n${list(c.value_props)}`,
    `objection_handling:\n${objs(c.objection_handling)}`,
    `closing: ${c.closing || '(empty)'}`,
    `playbook_narrative:\n${c.playbook_narrative || '(empty)'}`,
  ].join('\n');
}

/** Render the evidence sources (id + label + kind + content). The model MUST cite by source_id. */
function renderSources(sources: SourceRecord[]): string {
  const blocks = sources.map((s, i) => {
    const body = str(s.content).slice(0, 8000); // clamp each source so one huge one can't dominate
    return [
      `## SOURCE ${i + 1}`,
      `source_id: ${s.id}`,
      `source_label: ${sourceLabel(s)}`,
      `kind: ${s.kind}${s.niche ? `  niche: ${s.niche}` : ''}`,
      `content:`,
      body || '(no content)',
    ].join('\n');
  });
  return ['# EVIDENCE SOURCES (cite changes by source_id)', '', blocks.join('\n\n')].join('\n');
}

const REANALYZE_SYSTEM_PROMPT = `You are a senior sales coach REVISING an existing, in-use sales playbook using fresh EVIDENCE — the rep's own closed-won calls, teardown transcripts of top creators in the niche, and pasted notes.

Your job: propose a focused CHANGE-SET — a list of specific, high-signal edits to named fields of the current playbook. You are NOT rewriting it from scratch; you only propose changes where the evidence clearly supports an improvement.

You MUST call the emit_changeset tool. Each change targets exactly ONE field of the playbook (one of: persona, company_name, product_name, pricing, differentiators, objection_keywords, opener, discovery_questions, value_props, objection_handling, closing, playbook_narrative) and includes:
- field, op ('replace' to overwrite, 'append' to add to a list/text field)
- current_excerpt: a short snapshot of what's there now
- proposed_value: MUST match that field's type — a STRING for text fields (persona, company_name, product_name, pricing, differentiators, opener, closing, playbook_narrative); a STRING ARRAY for list fields (objection_keywords, discovery_questions, value_props); and an ARRAY OF {objection, response} OBJECTS for objection_handling. Never mismatch the type.
- rationale: why this change, grounded in the evidence
- confidence: 'high' | 'medium' | 'low'
- pattern_support: how broadly the evidence backs it, referencing MULTIPLE sources (e.g. "appears in 4 of 6 sources", "echoed by 3 won calls")
- citations: an array of { source_id, source_label, quote } where EVERY change cites at least ONE of the provided sources and quote is text actually drawn from that source's content.

HARD RULES:
- PATTERN-CONFIDENCE: Do NOT propose a change supported by only a SINGLE source unless you mark confidence:'low' and say so in pattern_support. Strongly prefer changes corroborated across MULTIPLE sources — those earn 'high'/'medium'.
- Every change MUST cite at least one provided source by its exact source_id, with a real quote from that source.
- NEVER invent pricing, company facts, product claims, or numbers that are not present in the sources or the current playbook. Use what's there; sharpen wording, don't fabricate.
- Keep the change-set focused: only propose edits the evidence justifies. A short, well-supported change-set beats a long speculative one. If the evidence supports no change, emit an empty changes array.
- Write proposed values in the same practical, verbatim-usable voice as the current playbook.`;

// ── public API ──────────────────────────────────────────────────────────────────

/**
 * Re-derive a CHANGE-SET for the tenant's active playbook from the provided extracted sources.
 * Pure analysis: returns the proposed change-set; does NOT persist or mutate anything.
 *
 * @param activeContent the CURRENT active PlaybookContent (base the changes apply against).
 * @param sources       the extracted sources to mine (each must have non-empty `content`).
 * @returns a normalized ChangeSet — every change targets a real field, has a type-correct
 *          proposed_value, and cites >=1 of the provided sources. Invalid changes are dropped.
 * @throws Error(CONNECT_ANTHROPIC) when no Anthropic key is connected (route → 400).
 * @throws Error (generic message) on any provider/parse failure (route → 502).
 */
export async function reanalyzePlaybook(
  activeContent: PlaybookContent,
  sources: SourceRecord[],
): Promise<ChangeSet> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(CONNECT_ANTHROPIC);

  // Only feed sources that actually carry content; build the trusted id→source map the
  // normalizer uses to validate citations.
  const usable = sources.filter((s) => str(s.content).length > 0);
  const sourceById = new Map(usable.map((s) => [s.id, s]));

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_changeset',
    description:
      'Emit a focused change-set: typed, cited, confidence-rated edits to named fields of the ' +
      'current sales playbook, justified by the provided evidence sources.',
    input_schema: {
      type: 'object',
      properties: {
        summary: {
          type: 'string',
          description: 'A one-line summary of what this change-set does and the evidence behind it.',
        },
        changes: {
          type: 'array',
          description: 'The proposed changes. Empty if the evidence supports no change.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                enum: PLAYBOOK_FIELDS as string[],
                description: 'Exactly one playbook field this change targets.',
              },
              op: {
                type: 'string',
                enum: ['replace', 'append'],
                description: "'replace' overwrites the field; 'append' adds to a list/text field.",
              },
              current_excerpt: {
                type: 'string',
                description: 'A short snapshot of what is in that field now.',
              },
              proposed_value: {
                description:
                  'The new value. STRING for text fields; STRING ARRAY for objection_keywords/' +
                  'discovery_questions/value_props; ARRAY of {objection,response} for ' +
                  'objection_handling. Must match the field type.',
              },
              rationale: { type: 'string', description: 'Why this change, grounded in the evidence.' },
              confidence: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: "Single-source changes MUST be 'low'.",
              },
              pattern_support: {
                type: 'string',
                description:
                  'How broadly the evidence backs it, referencing multiple sources ' +
                  '(e.g. "appears in 4 of 6 sources").',
              },
              citations: {
                type: 'array',
                description: 'At least one citation per change, by source_id, with a real quote.',
                items: {
                  type: 'object',
                  properties: {
                    source_id: { type: 'string', description: 'An exact source_id from the evidence.' },
                    source_label: { type: 'string', description: 'That source\'s label.' },
                    quote: { type: 'string', description: 'Text drawn from that source\'s content.' },
                  },
                  required: ['source_id', 'quote'],
                },
              },
            },
            required: [
              'field',
              'op',
              'current_excerpt',
              'proposed_value',
              'rationale',
              'confidence',
              'pattern_support',
              'citations',
            ],
          },
        },
      },
      required: ['summary', 'changes'],
    },
  };

  const userContent = [renderActivePlaybook(activeContent), '', renderSources(usable)].join('\n');

  let raw: unknown;
  try {
    const res = await client.messages.create({
      model: REANALYZE_MODEL,
      max_tokens: 4000,
      system: REANALYZE_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_changeset' },
      messages: [{ role: 'user', content: userContent }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_changeset',
    );
    if (!use) throw new Error('no_tool_use');
    raw = use.input;
  } catch (e) {
    // Never surface a raw provider error (billing/rate-limit/parse). The route maps this to 502.
    throw new Error(`reanalyze_failed: ${(e as Error)?.message ?? 'unknown'}`);
  }

  return normalizeChangeSet(raw, sourceById);
}

/** Validate/clamp the model's raw tool output into a clean ChangeSet. Exported so the route (or
 *  tests) can re-normalize a persisted raw change-set if needed. */
export function normalizeChangeSet(
  raw: unknown,
  sourceById: Map<string, SourceRecord>,
): ChangeSet {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const summary = str(r.summary).slice(0, 400);
  const rawChanges = Array.isArray(r.changes) ? r.changes : [];
  const changes: ChangeItem[] = [];
  for (const rc of rawChanges) {
    const norm = normalizeChange(rc, sourceById);
    if (norm) changes.push(norm);
  }
  return { summary, changes };
}
