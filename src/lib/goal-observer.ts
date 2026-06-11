// Goal observer — the "teacher" pattern. After each assistant message in a
// sub-agent's tool-use loop, a cheap Haiku call reads the message and judges
// whether it advances the agent's owned goal. If not, it emits a one-sentence
// correction that gets fed back into the loop as next-turn user-message
// context. Strictly best-effort: this layer must never break the parent run.

import Anthropic from '@anthropic-ai/sdk';
import { sql, tenantId } from './db/client';
import { getAnthropicKey } from './anthropic-key';

export interface ObserverVerdict {
  score: number;
  on_track: boolean;
  correction: string | null;
}

const OBSERVER_MODEL = 'claude-haiku-4-5-20251001';
const OBSERVER_SYSTEM =
  'You are a focused goal observer. You read one assistant message and judge whether it advances the stated goal. You output JSON only.';

/** Load the agent's most important owned goal (north star first, then soonest
 *  due). Same SELECT as goalDirectiveForAgent — returns null when the agent
 *  doesn't own an active goal. */
export async function getOwnedGoalForAgent(
  agentId: string,
): Promise<{ title: string; success: string } | null> {
  try {
    const rows = (await sql()`
      SELECT title, success
      FROM public.goals
      WHERE tenant_id = ${tenantId()}
        AND metadata->>'owner_agent' = ${agentId}
        AND status IN ('active', 'pending_verification')
      ORDER BY (metadata->>'is_north_star')::bool DESC NULLS LAST,
               due ASC NULLS LAST
      LIMIT 1
    `) as unknown as Array<{ title: string; success: string }>;
    const g = rows[0];
    if (!g) return null;
    return { title: g.title, success: g.success };
  } catch (e) {
    console.error('[getOwnedGoalForAgent] failed:', (e as Error).message);
    return null;
  }
}

/** Ask Haiku for a structured verdict. Returns null on any error so the parent
 *  loop never throws because of the teacher. */
export async function observeMessage(opts: {
  agentId: string;
  goalTitle: string;
  successCriterion: string;
  lastAssistantMessage: string;
}): Promise<ObserverVerdict | null> {
  const apiKey = await getAnthropicKey();
  if (!apiKey) return null;
  try {
    const client = new Anthropic({ apiKey, maxRetries: 2 });
    const userPrompt = [
      `# Owned goal`,
      opts.goalTitle,
      ``,
      `# Success criterion (verbatim)`,
      opts.successCriterion,
      ``,
      `# Assistant message to evaluate`,
      opts.lastAssistantMessage,
      ``,
      `Judge: does this message advance the goal toward the success criterion?`,
      `- score 0..1 (1 = strongly advances; 0 = off-topic/regressing)`,
      `- on_track = score >= 0.6`,
      `- if on_track is false, emit ONE sentence of corrective guidance (concrete, actionable). Otherwise correction = null.`,
      `Call the emit_verdict tool. Do not write prose.`,
    ].join('\n');

    const res = await client.messages.create({
      model: OBSERVER_MODEL,
      max_tokens: 256,
      system: OBSERVER_SYSTEM,
      tools: [
        {
          name: 'emit_verdict',
          description:
            'Emit a structured verdict on whether the assistant message advances the owned goal.',
          input_schema: {
            type: 'object',
            properties: {
              score: { type: 'number', description: '0..1 — how strongly the message advances the goal.' },
              on_track: { type: 'boolean', description: 'True iff score >= 0.6.' },
              correction: {
                type: ['string', 'null'],
                description: 'One sentence of corrective guidance when off-track; null when on-track.',
              },
            },
            required: ['score', 'on_track', 'correction'],
          },
        },
      ],
      tool_choice: { type: 'tool', name: 'emit_verdict' },
      messages: [{ role: 'user', content: userPrompt }],
    });

    const toolUse = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_verdict',
    );
    if (!toolUse) return null;
    const input = toolUse.input as { score?: unknown; on_track?: unknown; correction?: unknown };
    const rawScore = typeof input.score === 'number' ? input.score : Number(input.score);
    if (!Number.isFinite(rawScore)) return null;
    const score = Math.max(0, Math.min(1, rawScore));
    const on_track = typeof input.on_track === 'boolean' ? input.on_track : score >= 0.6;
    const correction =
      typeof input.correction === 'string' && input.correction.trim().length > 0
        ? input.correction.trim()
        : null;
    return { score, on_track, correction: on_track ? null : correction };
  } catch (e) {
    console.error('[observeMessage] failed:', (e as Error).message);
    return null;
  }
}
