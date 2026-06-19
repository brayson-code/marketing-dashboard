// playbook-gen.ts — Playbook Studio (Phase 1): turn the guided Q&A wizard answers into a
// DETAILED, verbatim-usable sales playbook with the TENANT'S BYO Anthropic key.
//
// generatePlaybook(answers) is the single entry point the generate route calls. It mirrors
// the Claude usage of the shipped SalesOps routes (summary/suggest) and the tool-forced
// pattern of campaign-intake/cron-nl: a single `emit_playbook` tool with input_schema =
// PlaybookContent and tool_choice forcing it, so the model returns structured JSON we read
// off the tool_use block (more robust than text-then-JSON.parse). We then VALIDATE +
// normalize that JSON and default-fill from the answers, so the function never returns a
// half-empty shape and never throws a raw provider/parse error.
//
// BYO key contract: getAnthropicKey() missing → throw new Error('connect_anthropic'). The
// route catches that exact message and returns 400 {error:'connect_anthropic'} (same contract
// as summary/suggest). Any other failure throws a generic message the route maps to 502.
//
// On Apply, content.persona/company_name/product_name/pricing/differentiators/objection_keywords
// + content.playbook_narrative (→ salesops_config.playbook) are mirrored into salesops_config,
// which /api/salesops/suggest's loadConfig() already reads — so the co-pilot uses the new
// playbook with no route change. The detailed fields (opener/discovery/value props/objection
// scripts/closing) are folded into playbook_narrative so the live coach consumes them too.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '../anthropic-key';

// Mirrors the model used by the shipped SalesOps routes (summary/suggest).
const PLAYBOOK_MODEL = 'claude-sonnet-4-5';

/** Thrown when the tenant has no Anthropic key connected. The route maps this exact
 *  message to 400 {error:'connect_anthropic'} (same contract as summary/suggest). */
export const CONNECT_ANTHROPIC = 'connect_anthropic';

// ── Answer schema (what the wizard asks) ─────────────────────────────────────
export interface PlaybookAnswers {
  company_name: string;       // "Acme Inc."
  product_name: string;       // what you sell
  buyer_persona: string;      // who you sell to
  pricing: string;            // "$499/mo, annual discount"
  differentiators: string;    // why you win
  sales_motion: string;       // e.g. "Inbound demo calls, 30 min" (free text)
  methodology?: string;       // optional: "Consultative" | "Challenger" | "SPIN" | free text
  common_objections: string;  // free text or comma list → seeds objection_keywords + scripts
  desired_tone: string;       // "confident, warm, concise"
  call_goal: string;          // "book a follow-up demo" | "close on the call"
}

// ── Output schema (structured playbook Claude returns) ───────────────────────
export interface ObjectionScript {
  objection: string;
  response: string;
}

export interface PlaybookContent {
  // Fields mirrored 1:1 into salesops_config on Apply (keep the co-pilot working):
  persona: string;              // → salesops_config.persona
  company_name: string;         // → salesops_config.company_name
  product_name: string;         // → salesops_config.product_name
  pricing: string;              // → salesops_config.pricing
  differentiators: string;      // → salesops_config.differentiators
  objection_keywords: string[]; // → salesops_config.objection_keywords
  // The detailed, verbatim-usable playbook that assembles into salesops_config.playbook:
  opener: string;                       // first 1-2 lines to open the call
  discovery_questions: string[];        // 4-8 questions
  value_props: string[];                // 3-6 punchy value props
  objection_handling: ObjectionScript[]; // scripts keyed to each named objection
  closing: string;                      // closing / next-step move
  playbook_narrative: string;           // full prose → salesops_config.playbook (the live coach reads this)
}

/**
 * Generate a structured sales playbook from the wizard answers, on the tenant's BYO key.
 * @throws Error('connect_anthropic') when no Anthropic key is connected (route → 400).
 * @throws Error (generic message) on any provider/parse failure (route → 502). Never
 *         surfaces a raw provider error and never returns a half-empty shape.
 */
export async function generatePlaybook(answers: PlaybookAnswers): Promise<PlaybookContent> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(CONNECT_ANTHROPIC);

  const client = new Anthropic({ apiKey, maxRetries: 2 });

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_playbook',
    description:
      'Emit ONE detailed, ready-to-use sales playbook derived from the rep\'s answers. ' +
      'Every field must be specific and verbatim-usable on a live call — no generic filler.',
    input_schema: {
      type: 'object',
      properties: {
        persona: {
          type: 'string',
          description: 'A 1-3 sentence buyer persona: who they sell to, their role, what they care about.',
        },
        company_name: { type: 'string', description: 'The company name, exactly as given in the answers.' },
        product_name: { type: 'string', description: 'What they sell, from the answers.' },
        pricing: { type: 'string', description: 'Pricing, exactly as given. NEVER invent prices beyond the answers.' },
        differentiators: { type: 'string', description: 'Why they win vs alternatives, from the answers — sharpened.' },
        objection_keywords: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Short trigger words/phrases (lowercase, 1-3 words each) derived from the common objections — ' +
            'the live coach watches the transcript for these. e.g. "too expensive", "need approval", "competitor".',
        },
        opener: {
          type: 'string',
          description: 'The exact first 1-2 lines the rep should open the call with, in the desired tone.',
        },
        discovery_questions: {
          type: 'array',
          items: { type: 'string' },
          description: '4-8 sharp discovery questions, verbatim, tailored to the buyer persona and product.',
        },
        value_props: {
          type: 'array',
          items: { type: 'string' },
          description: '3-6 punchy, specific value props grounded in the differentiators — one sentence each.',
        },
        objection_handling: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              objection: { type: 'string', description: 'the objection, as a prospect would phrase it' },
              response: { type: 'string', description: 'the exact rebuttal the rep can say verbatim' },
            },
            required: ['objection', 'response'],
          },
          description:
            'One script per named objection from the answers (plus the obvious adjacent ones). ' +
            'Each response is a verbatim rebuttal, not generic advice.',
        },
        closing: {
          type: 'string',
          description: 'The closing / next-step move that drives the stated call goal, phrased to say verbatim.',
        },
        playbook_narrative: {
          type: 'string',
          description:
            'The FULL playbook as readable prose (markdown ok): methodology, how to open, what to discover, ' +
            'which value props to lead with, how to handle each objection, and how to close. This is what the ' +
            'real-time coach reads — make it detailed and self-contained, weaving in the opener/discovery/value ' +
            'props/objection scripts/closing above.',
        },
      },
      required: [
        'persona',
        'company_name',
        'product_name',
        'pricing',
        'differentiators',
        'objection_keywords',
        'opener',
        'discovery_questions',
        'value_props',
        'objection_handling',
        'closing',
        'playbook_narrative',
      ],
    },
  };

  let raw: unknown;
  try {
    const res = await client.messages.create({
      model: PLAYBOOK_MODEL,
      max_tokens: 2000,
      system: SALES_PLAYBOOK_SYSTEM_PROMPT,
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_playbook' },
      messages: [{ role: 'user', content: renderAnswersBrief(answers) }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_playbook',
    );
    if (!use) throw new Error('no_tool_use');
    raw = use.input;
  } catch (e) {
    // Never surface a raw provider error (billing/rate-limit/parse). The route maps this to 502.
    throw new Error(`playbook_generation_failed: ${(e as Error)?.message ?? 'unknown'}`);
  }

  return normalizePlaybook(raw, answers);
}

// ── System prompt — a strong senior-sales-coach brief ────────────────────────
const SALES_PLAYBOOK_SYSTEM_PROMPT = `You are a senior sales coach building a tactical, ready-to-use playbook for a closer who will read it DURING live calls.

Your output must be SPECIFIC and VERBATIM-USABLE — actual words the rep can say, not generic "build rapport" advice. Tailor everything to the company, product, buyer persona, pricing, differentiators, sales motion, methodology, and the stated call goal in the rep's brief.

Hard rules:
- NEVER invent facts the rep didn't give you — especially pricing, company name, or product claims. Use exactly what they provided; sharpen the wording, don't fabricate.
- Write in the desired tone the rep specified.
- objection_keywords: derive short lowercase trigger phrases from the common objections (these power a live transcript watcher) — keep them 1-3 words.
- objection_handling: write one script per objection the rep named (and the obvious adjacent ones). Each response is a verbatim rebuttal.
- playbook_narrative: assemble a complete, self-contained playbook in readable prose that folds in the opener, discovery questions, value props, objection scripts, and closing — this is the text a real-time AI coach will consume on every call, so make it detailed and methodology-aware.

Always call the emit_playbook tool with every field filled.`;

/** Render the wizard answers as a structured brief for the model. */
function renderAnswersBrief(a: PlaybookAnswers): string {
  const line = (label: string, v: string | undefined): string =>
    v && v.trim() ? `${label}: ${v.trim()}` : '';
  return [
    'Build a sales playbook from these answers:',
    '',
    line('Company', a.company_name),
    line('Product / what we sell', a.product_name),
    line('Buyer persona (who we sell to)', a.buyer_persona),
    line('Pricing', a.pricing),
    line('Differentiators (why we win)', a.differentiators),
    line('Sales motion', a.sales_motion),
    line('Methodology', a.methodology),
    line('Common objections', a.common_objections),
    line('Desired tone', a.desired_tone),
    line('Goal of the call', a.call_goal),
  ]
    .filter(Boolean)
    .join('\n');
}

// ── Validation / normalization ───────────────────────────────────────────────
// The model's tool output is shape-guided but not guaranteed. Coerce every field to its
// declared type, default-fill from the answers, and cap array sizes — so the function
// always returns a complete PlaybookContent and never throws on a malformed field.

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

function normalizePlaybook(raw: unknown, answers: PlaybookAnswers): PlaybookContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  // Default-fill the salesops_config-mirrored fields from the answers when the model left
  // them blank, so Apply never writes an empty config field.
  const persona = str(r.persona) || str(answers.buyer_persona);
  const company_name = str(r.company_name) || str(answers.company_name);
  const product_name = str(r.product_name) || str(answers.product_name);
  const pricing = str(r.pricing) || str(answers.pricing);
  const differentiators = str(r.differentiators) || str(answers.differentiators);

  let objection_keywords = strArray(r.objection_keywords, 24).map((k) => k.toLowerCase());
  if (!objection_keywords.length) {
    // Fall back to the raw comma/newline objections the rep typed.
    objection_keywords = strArray(answers.common_objections, 24).map((k) => k.toLowerCase());
  }

  const opener = str(r.opener);
  const discovery_questions = strArray(r.discovery_questions, 12);
  const value_props = strArray(r.value_props, 10);
  const objection_handling = objectionScripts(r.objection_handling, 16);
  const closing = str(r.closing);

  // playbook_narrative is what the live coach reads. If the model somehow omitted it,
  // synthesize a readable one from the structured fields so the co-pilot never gets an
  // empty playbook after Apply.
  let playbook_narrative = str(r.playbook_narrative);
  if (!playbook_narrative) {
    playbook_narrative = synthesizeNarrative({
      persona,
      company_name,
      product_name,
      pricing,
      differentiators,
      opener,
      discovery_questions,
      value_props,
      objection_handling,
      closing,
    });
  }

  return {
    persona,
    company_name,
    product_name,
    pricing,
    differentiators,
    objection_keywords,
    opener,
    discovery_questions,
    value_props,
    objection_handling,
    closing,
    playbook_narrative,
  };
}

/** Assemble a readable narrative from the structured fields (fallback only). */
function synthesizeNarrative(p: Omit<PlaybookContent, 'objection_keywords' | 'playbook_narrative'>): string {
  const parts: string[] = [];
  if (p.persona) parts.push(`## Buyer\n${p.persona}`);
  const ctx = [
    p.company_name && `Company: ${p.company_name}`,
    p.product_name && `Product: ${p.product_name}`,
    p.pricing && `Pricing: ${p.pricing}`,
    p.differentiators && `Differentiators: ${p.differentiators}`,
  ].filter(Boolean);
  if (ctx.length) parts.push(`## Context\n${ctx.join('\n')}`);
  if (p.opener) parts.push(`## Opener\n${p.opener}`);
  if (p.discovery_questions.length)
    parts.push(`## Discovery\n${p.discovery_questions.map((q) => `- ${q}`).join('\n')}`);
  if (p.value_props.length)
    parts.push(`## Value props\n${p.value_props.map((v) => `- ${v}`).join('\n')}`);
  if (p.objection_handling.length)
    parts.push(
      `## Objection handling\n${p.objection_handling
        .map((o) => `- "${o.objection}" → ${o.response}`)
        .join('\n')}`,
    );
  if (p.closing) parts.push(`## Closing\n${p.closing}`);
  return parts.join('\n\n');
}
