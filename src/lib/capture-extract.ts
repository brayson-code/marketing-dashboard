// Turn onboarding call notes into capture fields — SERVER.
//
// WHY: the capture form is 17 boxes. Filling it in while talking to a client means
// typing instead of listening, and Client Success already takes notes on that call. So
// they paste the notes and this fills in what it can find.
//
// IT DRAFTS, IT DOES NOT SAVE. The extraction lands in the form for a human to read and
// correct before anything is written. That matters more here than almost anywhere else
// in the product: these answers become BINDING instructions in every agent's system
// prompt, and "what your assistant can approve without asking" is not a field to let a
// model guess at unreviewed.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from './anthropic-key';
import { CAPTURE_FIELDS } from './onboarding-capture-catalog';

export interface Extraction {
  values: Record<string, string>;
  /** Fields the notes genuinely did not cover, so the operator knows what to go back for. */
  missing: string[];
}

/**
 * Pull capture answers out of free-form notes.
 *
 * The schema is built FROM the catalog rather than restated, so adding a capture field
 * cannot silently fail to be extracted.
 */
export async function extractFromNotes(notes: string): Promise<Extraction> {
  const text = String(notes ?? '').trim();
  if (text.length < 40) {
    throw new Error('Paste a bit more of the call notes — there is not enough here to work from.');
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) throw new Error(NO_ANTHROPIC_KEY_MESSAGE);

  const properties: Record<string, { type: 'string'; description: string }> = {};
  for (const f of CAPTURE_FIELDS) {
    properties[f.key] = {
      type: 'string',
      // The QUESTION is the best description of the field — it is what was actually
      // asked on the call, so it matches the shape of the notes.
      description: `${f.label}. The question asked was: "${f.ask}". Omit entirely if the notes do not answer it.`,
    };
  }

  const client = new Anthropic({ apiKey, maxRetries: 3 });
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    tools: [{
      name: 'emit_capture',
      description: 'Emit the onboarding answers found in the notes.',
      input_schema: { type: 'object', properties },
    }],
    tool_choice: { type: 'tool', name: 'emit_capture' },
    messages: [{
      role: 'user',
      content:
        'These are notes from a client onboarding call. Pull out the answers to the ' +
        'fields in the tool.\n\n' +
        'Rules:\n' +
        '- Use the CLIENT\'S OWN WORDS wherever you can. These answers go into an AI ' +
        'system prompt as binding instructions, so a tidy paraphrase can quietly change ' +
        'what an assistant is allowed to do.\n' +
        '- OMIT any field the notes do not actually answer. A plausible guess is worse ' +
        'than a blank: a blank gets asked about, a guess gets trusted.\n' +
        '- Do not infer approval limits, escalation rules or spend authority from ' +
        'anything less than an explicit statement.\n\n' +
        `NOTES:\n${text}`,
    }],
  });

  const block = response.content.find(c => c.type === 'tool_use');
  const raw = (block && block.type === 'tool_use' ? block.input : {}) as Record<string, unknown>;

  const values: Record<string, string> = {};
  for (const f of CAPTURE_FIELDS) {
    const v = raw[f.key];
    if (typeof v === 'string' && v.trim()) values[f.key] = v.trim();
  }

  return {
    values,
    missing: CAPTURE_FIELDS.filter(f => !values[f.key]).map(f => f.label),
  };
}
