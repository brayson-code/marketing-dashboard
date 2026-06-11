// Bounded skeptic verification — ported from the ultracode "adversarial verify"
// pattern, but constraint-respecting. After a wave's parallel agents return and
// BEFORE synthesis, ONE cheap Haiku call reviews the combined findings and flags
// claims that look unverifiable / single-source / undated / internally
// inconsistent / overstated. The flags get folded into the wave synthesis (and
// thus the final report's confidence section) so the owner sees what's shaky
// before making a spend decision.
//
// Deliberately NOT the harness's N-skeptics-per-finding fan-out: that multiplies
// cost unboundedly and blows the ~5 req/min Anthropic cap. This is exactly ONE
// pass per wave, capped input, best-effort (returns null on any error, never
// blocks the wave). Same single-shot tool_choice-forced shape as wave-observer.ts.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from './anthropic-key';

const VERIFY_MODEL = 'claude-haiku-4-5'; // a flag pass, not generation — cheapest tier
// Haiku's context window is huge (200k); a few thousand tokens of output from
// 2-3 agents fits comfortably. Cap generously so the skeptic sees the WHOLE
// wave, not just agent 1's opening — a partial check that returns "high
// confidence" on 12% of the material is worse than no check. When we DO exceed
// this, we mark the verification partial so the report says so honestly.
const INPUT_CAP = 24000;
const MIN_INPUT = 80; // below this there's nothing worth checking

export type FlagReason =
  | 'unverifiable'
  | 'single_source'
  | 'undated'
  | 'internally_inconsistent'
  | 'overstated';

export interface WaveVerification {
  flagged: Array<{ claim: string; reason: FlagReason }>;
  overall_confidence: 'high' | 'medium' | 'low';
  note: string;
  /** True when the combined findings exceeded INPUT_CAP and only the first
   *  portion was fact-checked — surfaced in the report so confidence isn't
   *  read as covering material the skeptic never saw. */
  partial: boolean;
}

export async function verifyWaveFindings(opts: {
  objective: string;
  successCriterion?: string;
  combinedFindings: string;
}): Promise<WaveVerification | null> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) return null;
  const full = opts.combinedFindings ?? '';
  const body = full.slice(0, INPUT_CAP);
  const partial = full.length > INPUT_CAP;
  if (body.trim().length < MIN_INPUT) return null;

  try {
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    const tool: Anthropic.Messages.Tool = {
      name: 'emit_verification',
      description: 'Flag claims in the research that are unverifiable, single-source, undated, internally inconsistent, or overstated. Do NOT rewrite or add findings.',
      input_schema: {
        type: 'object',
        properties: {
          flagged: {
            type: 'array',
            description: 'The genuinely shaky claims — quote each briefly. Empty if the research is solid.',
            items: {
              type: 'object',
              properties: {
                claim: { type: 'string', description: 'the specific shaky claim, quoted briefly' },
                reason: { type: 'string', enum: ['unverifiable', 'single_source', 'undated', 'internally_inconsistent', 'overstated'] },
              },
              required: ['claim', 'reason'],
            },
          },
          overall_confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          note: { type: 'string', description: "one sentence on this wave's reliability for the owner" },
        },
        required: ['flagged', 'overall_confidence', 'note'],
      },
    };

    const res = await client.messages.create({
      model: VERIFY_MODEL,
      max_tokens: 512,
      system:
        'You are a skeptical fact-checker for a marketing research agency whose reports drive real spend decisions. ' +
        'You DO NOT rewrite, add, or expand findings — you ONLY flag claims that are unverifiable, rest on a single source, ' +
        'lack a date, contradict another claim, or are overstated. Be conservative: flag the genuinely shaky, not everything. ' +
        'A solid wave should return an empty flagged array and high confidence. Call emit_verification. Output JSON only.',
      tool_choice: { type: 'tool', name: 'emit_verification' },
      tools: [tool],
      messages: [
        {
          role: 'user',
          content:
            `Objective: ${opts.objective}\n` +
            (opts.successCriterion ? `Success criterion: ${opts.successCriterion}\n` : '') +
            `\nResearch to fact-check:\n\n${body}`,
        },
      ],
    });

    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_verification',
    );
    if (!use) return null;
    const input = use.input as Partial<WaveVerification>;
    const conf = input.overall_confidence;
    return {
      flagged: Array.isArray(input.flagged) ? input.flagged.slice(0, 12) : [],
      overall_confidence: conf === 'high' || conf === 'low' ? conf : 'medium',
      note: String(input.note ?? '').slice(0, 300),
      partial,
    };
  } catch (e) {
    console.error('[wave-verify] failed:', (e as Error).message);
    return null;
  }
}

/** Render the verification as a markdown block to append to a wave synthesis.
 *  Returns '' when there's nothing worth surfacing (solid + no flags). */
export function verificationToMarkdown(v: WaveVerification | null): string {
  if (!v) return '';
  // A clean, fully-covered wave needs no note — but a PARTIAL check always
  // surfaces, even when nothing was flagged, so "high confidence" is never
  // mistaken for "we checked everything."
  if (v.flagged.length === 0 && v.overall_confidence === 'high' && !v.partial) return '';
  const lines: string[] = [`\n\n## Reliability check (${v.overall_confidence} confidence)`];
  if (v.partial) lines.push('_Note: only the first portion of this wave’s findings was fact-checked (volume exceeded the check budget)._');
  if (v.note) lines.push(v.note);
  if (v.flagged.length > 0) {
    lines.push('');
    for (const f of v.flagged) lines.push(`- ⚠️ ${f.reason.replace(/_/g, ' ')}: ${f.claim}`);
  }
  return lines.join('\n');
}
