// Wave-boundary observer — Phase of the self-improving Command Center.
// At the END of each PARL wave, this checks the wave's synthesis against the
// mission's goal success criterion and, if drift exceeds a threshold, returns a
// corrective hint that gets prepended to the NEXT wave's brief before it runs.
//
// Design notes:
// - Sonnet, not Haiku: wave-boundary checks are rare (≤ N times per mission)
//   and the cost of a bad course-correct hint is high (wastes a whole wave).
// - Tool-only output (emit_drift) so we never have to parse free-form JSON.
// - Returns null on ANY error — observer must never block wave chaining.
// - Caller is responsible for cost-guarding (don't call when there's no next
//   wave) and for bounding the synthesis input length.
//
// Env-var kill switch: WAVE_OBSERVER=off disables (caller checks).

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from './anthropic-key';

const OBSERVER_MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 384;

export interface WaveDrift {
  drift_score: number;       // 0 = perfectly on-track, 1 = fully off-course
  on_track: boolean;         // drift_score < 0.4
  corrective_hint: string | null; // ≤ 2 sentences, null when on_track
}

interface ObserveOpts {
  waveLabel: string;
  waveSynthesis: string;
  goalTitle: string;
  successCriterion: string;
  remainingWaveLabels: string[];
}

const SYSTEM =
  'You are a mission overseer. You read what a wave just produced and judge ' +
  'whether the mission is converging on its success criterion. You output JSON only.';

const EMIT_DRIFT_TOOL: Anthropic.Tool = {
  name: 'emit_drift',
  description:
    'Report whether the wave that just finished is keeping the mission on-course toward ' +
    'its success criterion, and if not, what the NEXT wave should do differently.',
  input_schema: {
    type: 'object',
    properties: {
      drift_score: {
        type: 'number',
        description: '0 = perfectly on-track with the success criterion. 1 = fully off-course.',
        minimum: 0,
        maximum: 1,
      },
      on_track: {
        type: 'boolean',
        description: 'True iff drift_score < 0.4.',
      },
      corrective_hint: {
        type: ['string', 'null'],
        description:
          'At most 2 sentences telling the NEXT wave what to do differently to re-converge. ' +
          'Null when on_track is true.',
      },
    },
    required: ['drift_score', 'on_track', 'corrective_hint'],
  },
};

function buildUser(opts: ObserveOpts): string {
  const remaining = opts.remainingWaveLabels.length
    ? opts.remainingWaveLabels.map((l, i) => `  ${i + 1}. ${l}`).join('\n')
    : '  (none — this was the last wave)';
  return [
    `# Mission goal`,
    opts.goalTitle,
    ``,
    `# Success criterion (verbatim)`,
    opts.successCriterion,
    ``,
    `# Wave that just finished`,
    opts.waveLabel,
    ``,
    `# Synthesis produced by that wave`,
    opts.waveSynthesis,
    ``,
    `# Remaining waves (in order)`,
    remaining,
    ``,
    `Judge how far the synthesis has drifted from the success criterion. If on-track ` +
      `(drift_score < 0.4), set corrective_hint to null. Otherwise, write a ≤2-sentence hint ` +
      `that tells the NEXT wave what to do differently to re-converge. Call emit_drift.`,
  ].join('\n');
}

/**
 * Returns null on any error — never block wave chaining. Caller should also
 * cost-guard (skip when there are no remaining waves) and length-cap the
 * synthesis so a runaway wave can't blow the prompt budget.
 */
export async function observeWaveBoundary(opts: ObserveOpts): Promise<WaveDrift | null> {
  try {
    const apiKey = await getAnthropicKey();
    if (!apiKey) return null;
    const res = await new Anthropic({ apiKey, maxRetries: 2 }).messages.create({
      model: OBSERVER_MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      tools: [EMIT_DRIFT_TOOL],
      tool_choice: { type: 'tool', name: 'emit_drift' },
      messages: [{ role: 'user', content: buildUser(opts) }],
    });
    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_drift',
    );
    if (!toolUse) return null;
    const input = toolUse.input as Partial<WaveDrift> | undefined;
    if (!input || typeof input.drift_score !== 'number') return null;
    const score = Math.max(0, Math.min(1, input.drift_score));
    const onTrack = typeof input.on_track === 'boolean' ? input.on_track : score < 0.4;
    let hint: string | null = null;
    if (!onTrack) {
      const raw = input.corrective_hint;
      if (typeof raw === 'string') {
        const trimmed = raw.trim();
        hint = trimmed.length > 0 ? trimmed : null;
      }
    }
    return { drift_score: score, on_track: onTrack, corrective_hint: hint };
  } catch (e) {
    console.error('[wave-observer] failed:', (e as Error).message);
    return null;
  }
}
