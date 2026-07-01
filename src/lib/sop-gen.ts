// sop-gen.ts — SOP Generator: turn a short guided Q&A (SOPAnswers) into a clean, scannable
// Standard Operating Procedure document, rendered as plain-English markdown, using the
// TENANT'S BYO Anthropic key.
//
// This mirrors src/lib/salesops/playbook-gen.ts EXACTLY (the shipped generation template):
// a single tool-forced Claude call whose `emit_sop` tool has an input_schema describing a
// clean structured SOP, so the model returns structured JSON we read off the tool_use block
// (more robust than text-then-JSON.parse). We then RENDER that structured object into
// readable markdown (H1 title, one-line Purpose, Scope, a Roles list, NUMBERED steps each
// with a bold name + plain-English detail, and Notes) so the Reports view can render it with
// react-markdown into clean plain English.
//
// BYO key contract: getAnthropicKey() missing → throw new Error('connect_anthropic'). The
// generate route catches that exact message and returns 400 {error:'connect_anthropic'}.
// Any other failure throws a generic message the route maps to 502 {error:'generate_failed'} —
// we never surface a raw provider/parse error.
//
// The generated markdown is saved (by the UI) via the existing POST /api/documents with
// type:"sop" — this module and its route only PRODUCE the draft; they never write.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/anthropic-key';
import { CONNECT_ANTHROPIC } from '@/lib/salesops/playbook-gen';

// Re-export the exact BYO-key token so the generate route can map it to 400 without
// reaching into salesops — one source of truth for the message string.
export { CONNECT_ANTHROPIC };

// Mirrors the model used by the shipped SalesOps / Playbook Studio generation routes.
const SOP_MODEL = 'claude-sonnet-4-5';

// ── Answer schema (what the SOP wizard asks) ─────────────────────────────────
export interface SOPAnswers {
  title: string;           // "Onboard a new client workspace"
  purpose: string;         // why this SOP exists / the outcome it guarantees
  scope?: string;          // what it covers (and what it doesn't)
  audience?: string;       // who runs this (roles/teams)
  steps_outline?: string;  // free text / rough bullet list of the steps
  tools?: string;          // systems/tools involved
  notes?: string;          // caveats, edge cases, gotchas
}

// ── Output schema (structured SOP Claude returns) ────────────────────────────
export interface SOPRole {
  role: string;
  responsibility: string;
}

export interface SOPStep {
  name: string;
  detail: string;
}

export interface SOPContent {
  title: string;
  purpose: string;
  scope: string;
  roles: SOPRole[];
  steps: SOPStep[];
  notes: string;
}

/**
 * Generate a structured SOP from the wizard answers, on the tenant's BYO key, and render it
 * to clean scannable markdown.
 * @returns { title, markdown } — title for the document row, markdown for its content.
 * @throws Error('connect_anthropic') when no Anthropic key is connected (route → 400).
 * @throws Error (generic message) on any provider/parse failure (route → 502). Never
 *         surfaces a raw provider error.
 */
export async function generateSOP(answers: SOPAnswers): Promise<{ title: string; markdown: string }> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(CONNECT_ANTHROPIC);

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_sop',
    description:
      'Emit ONE clear, ready-to-follow Standard Operating Procedure derived from the answers. ' +
      'Every field must be specific and written in plain English an operator can act on — no generic filler.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'A short, action-oriented SOP title, based on the answer — e.g. "Onboard a new client workspace".',
        },
        purpose: {
          type: 'string',
          description: 'One or two plain sentences: why this SOP exists and the outcome it guarantees.',
        },
        scope: {
          type: 'string',
          description: 'What this procedure covers (and, where relevant, what it explicitly does NOT cover).',
        },
        roles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              role: { type: 'string', description: 'the role or team, e.g. "Onboarding specialist"' },
              responsibility: { type: 'string', description: 'what that role is responsible for in this procedure' },
            },
            required: ['role', 'responsibility'],
          },
          description:
            'The roles involved and what each is responsible for. Derive from the stated audience; ' +
            'keep it to the roles that actually do something in the steps.',
        },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'a short imperative step name, e.g. "Provision the workspace"' },
              detail: {
                type: 'string',
                description: 'plain-English detail: exactly what to do in this step, including any tool used',
              },
            },
            required: ['name', 'detail'],
          },
          description:
            'The ordered steps to execute the procedure, most 4-12 steps. Each step has a short imperative ' +
            'name and a plain-English detail an operator can follow verbatim. Expand the rough outline given.',
        },
        notes: {
          type: 'string',
          description: 'Caveats, edge cases, or gotchas worth calling out. Empty string if none.',
        },
      },
      required: ['title', 'purpose', 'scope', 'roles', 'steps', 'notes'],
    },
  };

  let raw: unknown;
  try {
    const res = await client.messages.create({
      model: SOP_MODEL,
      max_tokens: 2500,
      system: SOP_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_sop' },
      messages: [{ role: 'user', content: renderAnswersBrief(answers) }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_sop',
    );
    if (!use) throw new Error('no_tool_use');
    raw = use.input;
  } catch (e) {
    // Never surface a raw provider error (billing/rate-limit/parse). The route maps this to 502.
    throw new Error(`sop_generation_failed: ${(e as Error)?.message ?? 'unknown'}`);
  }

  const sop = normalizeSOP(raw, answers);
  return { title: sop.title, markdown: renderMarkdown(sop) };
}

// ── System prompt — a strong operations-writer brief ─────────────────────────
const SOP_SYSTEM_PROMPT = `You are an operations lead writing a Standard Operating Procedure (SOP) that a teammate will follow step by step to get a task done correctly every time.

Your output must be SPECIFIC and PLAIN-ENGLISH — concrete actions the operator can follow verbatim, not vague advice like "communicate clearly". Tailor everything to the title, purpose, scope, audience, tools, and rough step outline in the brief.

Hard rules:
- NEVER invent facts the author didn't give you. Expand and sharpen what they provided; don't fabricate tools, systems, or policies.
- steps: turn the rough outline into an ordered, complete sequence. Each step gets a short imperative name and a plain-English detail the operator can act on. Name the tool used in a step when it's relevant.
- roles: only include roles that actually do something in the steps; state what each is responsible for.
- Keep it scannable and simple — no exotic formatting, no jargon where a plain word works.

Always call the emit_sop tool with every field filled (use an empty string for notes if there are none).`;

/** Render the wizard answers as a structured brief for the model. */
function renderAnswersBrief(a: SOPAnswers): string {
  const line = (label: string, v: string | undefined): string =>
    v && v.trim() ? `${label}: ${v.trim()}` : '';
  return [
    'Write a Standard Operating Procedure from these answers:',
    '',
    line('Title', a.title),
    line('Purpose', a.purpose),
    line('Scope', a.scope),
    line('Audience (who runs this)', a.audience),
    line('Rough step outline', a.steps_outline),
    line('Tools / systems involved', a.tools),
    line('Notes / caveats', a.notes),
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Validation / normalization ───────────────────────────────────────────────
// The model's tool output is shape-guided but not guaranteed. Coerce every field to its
// declared type, default-fill from the answers, and cap array sizes — so the function
// always returns a complete SOPContent and never throws on a malformed field.

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

function roles(v: unknown, cap: number): SOPRole[] {
  if (!Array.isArray(v)) return [];
  const out: SOPRole[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const role = str((item as Record<string, unknown>).role);
      const responsibility = str((item as Record<string, unknown>).responsibility);
      if (role || responsibility) out.push({ role, responsibility });
    }
    if (out.length >= cap) break;
  }
  return out;
}

function steps(v: unknown, cap: number): SOPStep[] {
  if (!Array.isArray(v)) return [];
  const out: SOPStep[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const name = str((item as Record<string, unknown>).name);
      const detail = str((item as Record<string, unknown>).detail);
      if (name || detail) out.push({ name, detail });
    }
    if (out.length >= cap) break;
  }
  return out;
}

function normalizeSOP(raw: unknown, answers: SOPAnswers): SOPContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  // Default-fill from the answers when the model left a field blank, so the rendered SOP is
  // never half-empty.
  const title = str(r.title) || str(answers.title);
  const purpose = str(r.purpose) || str(answers.purpose);
  const scope = str(r.scope) || str(answers.scope);
  const roleList = roles(r.roles, 12);
  let stepList = steps(r.steps, 30);
  if (!stepList.length) {
    // Fall back to the rough outline the author typed (one step per line).
    stepList = str(answers.steps_outline)
      .split(/\n+/)
      .map((s) => s.replace(/^\s*(?:\d+[.)]|[-*])\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 30)
      .map((detail) => ({ name: '', detail }));
  }
  const notes = str(r.notes) || str(answers.notes);

  return { title, purpose, scope, roles: roleList, steps: stepList, notes };
}

// ── Render structured SOP → clean, scannable markdown ────────────────────────
// Standard markdown only (no exotic syntax) so react-markdown renders readable plain English:
// an H1 title, a one-line Purpose, a Scope line, a Roles list, NUMBERED steps (bold name +
// detail), and a Notes section.
function renderMarkdown(sop: SOPContent): string {
  const parts: string[] = [];

  parts.push(`# ${sop.title || 'Standard Operating Procedure'}`);

  if (sop.purpose) parts.push(`**Purpose:** ${sop.purpose}`);
  if (sop.scope) parts.push(`**Scope:** ${sop.scope}`);

  if (sop.roles.length) {
    const lines = sop.roles.map((r) =>
      r.role && r.responsibility
        ? `- **${r.role}** — ${r.responsibility}`
        : `- ${r.role || r.responsibility}`,
    );
    parts.push(`## Roles\n\n${lines.join('\n')}`);
  }

  if (sop.steps.length) {
    const lines = sop.steps.map((s, i) => {
      const n = i + 1;
      if (s.name && s.detail) return `${n}. **${s.name}** — ${s.detail}`;
      return `${n}. ${s.name || s.detail}`;
    });
    parts.push(`## Steps\n\n${lines.join('\n')}`);
  }

  if (sop.notes) parts.push(`## Notes\n\n${sop.notes}`);

  return parts.join('\n\n');
}
