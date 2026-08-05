import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from '@/lib/anthropic-key';
import { getCompanyPlaybook, saveCompanyPlaybook, savePlaybookAnswers, type PlaybookAnswers } from '@/lib/company-playbook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// GET /api/playbook → the workspace's current company playbook (markdown + answers).
export async function GET() {
  enterTenant(await resolveTenant());
  try {
    return NextResponse.json(await getCompanyPlaybook());
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

const FIELDS: Array<{ key: keyof PlaybookAnswers; label: string }> = [
  { key: 'business', label: 'What the company does' },
  { key: 'objective', label: 'Primary objective right now' },
  { key: 'audience', label: 'Ideal customer / ICP' },
  { key: 'value', label: 'Core value proposition / differentiation' },
  { key: 'channels', label: 'Primary marketing channels' },
  { key: 'voice', label: 'Brand voice / tone' },
  { key: 'constraints', label: 'Hard no-gos / off-limits' },
];

// POST /api/playbook { answers, save? } → generate a tight company playbook from the
// questionnaire answers and (by default) save it onto the workspace so every agent
// reads it. Runs on the tenant's own Anthropic key (BYO).
export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  let body: { answers?: PlaybookAnswers; save?: boolean; markdown?: string; answers_only?: boolean };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // Direct edit/save path: persist an edited markdown without regenerating.
  if (typeof body.markdown === 'string' && body.markdown.trim()) {
    const answers = (body.answers ?? {}) as PlaybookAnswers;
    await saveCompanyPlaybook(body.markdown.trim(), answers, new Date().toISOString());
    return NextResponse.json({ ok: true, markdown: body.markdown.trim(), answers });
  }

  // Answers-only save — the Business Setup wizard, which saves after every step.
  // Keeps any existing brief untouched and never needs an Anthropic key, so a
  // workspace can complete setup before it has connected one.
  if (body.answers_only === true) {
    await savePlaybookAnswers((body.answers ?? {}) as PlaybookAnswers, new Date().toISOString());
    return NextResponse.json({ ok: true, answers: body.answers ?? {} });
  }

  const answers = (body.answers ?? {}) as PlaybookAnswers;
  const filled = FIELDS.filter((f) => String(answers[f.key] ?? '').trim());
  if (filled.length === 0) {
    return NextResponse.json({ error: 'Answer at least a couple of questions so we can draft your playbook.' }, { status: 400 });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) return NextResponse.json({ error: NO_ANTHROPIC_KEY_MESSAGE }, { status: 400 });

  const intake = filled.map((f) => `${f.label}: ${String(answers[f.key]).trim()}`).join('\n');

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_playbook',
    description: 'Emit the finished company playbook as clean markdown.',
    input_schema: {
      type: 'object',
      properties: {
        markdown: {
          type: 'string',
          description:
            'The company playbook in markdown. Sections: "## Who we are" (1-2 lines), "## What we are driving toward" (the objective, made concrete), "## Who we serve" (ICP + their jobs-to-be-done), "## Why us" (value prop + differentiation), "## Where we show up" (channels + how we use each), "## Voice" (3-5 concrete tone rules with do/don\'t), "## Guardrails" (hard no-gos). Tight and operational — an agent should be able to act on every line. No preamble, no fluff.',
        },
      },
      required: ['markdown'],
    },
  };

  try {
    const client = new Anthropic({ apiKey, maxRetries: 4 });
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1600,
      system:
        'You are a sharp brand + GTM strategist. Turn a founder\'s short intake into a tight, operational ' +
        'COMPANY PLAYBOOK that every AI marketing agent will read before doing work. Be concrete and specific to ' +
        'THIS business — infer sensibly from sparse answers but never invent facts (names, numbers, claims). ' +
        'The voice section must give rules an agent can follow. Always call emit_playbook.',
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_playbook' },
      messages: [{ role: 'user', content: `Company intake:\n\n${intake}` }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_playbook',
    );
    const markdown = use ? String((use.input as { markdown?: string }).markdown ?? '').trim() : '';
    if (!markdown) return NextResponse.json({ error: 'Could not draft a playbook — add a bit more detail and retry.' }, { status: 502 });

    if (body.save !== false) {
      await saveCompanyPlaybook(markdown, answers, new Date().toISOString());
    }
    return NextResponse.json({ ok: true, markdown, answers, saved: body.save !== false });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
