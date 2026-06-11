import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from '@/lib/anthropic-key';
import { getCompanyPlaybookMarkdown } from '@/lib/company-playbook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/agents/defs/:id/generate { answers, name, role }
// The per-agent playbook generator: a short questionnaire about THIS agent's
// objectives → a complete soul/agent/skills definition. Returns the generated
// fields (does NOT save) so the Agent Studio editor populates them for review +
// tuning before the owner hits Save (the existing PUT). Grounded in the company
// playbook so the agent aligns with the business. Runs on the tenant's BYO key.

interface Answers {
  job?: string; output?: string; inputs?: string; guardrails?: string; tactics?: string;
}
const Q: Array<{ key: keyof Answers; label: string }> = [
  { key: 'job', label: 'Core job / responsibility' },
  { key: 'output', label: 'What an excellent result looks like (format, quality bar)' },
  { key: 'inputs', label: 'What it works from (inputs/context)' },
  { key: 'guardrails', label: 'Hard rules / never-dos' },
  { key: 'tactics', label: 'Specific tactics, frameworks, or steps to follow' },
];

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  enterTenant(await resolveTenant());
  const { id } = await params;

  let body: { answers?: Answers; name?: string; role?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const answers = body.answers ?? {};
  const name = (body.name ?? id).trim();
  const role = (body.role ?? 'general').trim();
  const filled = Q.filter((q) => String(answers[q.key] ?? '').trim());
  if (!String(answers.job ?? '').trim()) {
    return NextResponse.json({ error: 'Describe the agent’s core job to generate its playbook.' }, { status: 400 });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) return NextResponse.json({ error: NO_ANTHROPIC_KEY_MESSAGE }, { status: 400 });

  const company = await getCompanyPlaybookMarkdown();
  const intake = filled.map((q) => `${q.label}: ${String(answers[q.key]).trim()}`).join('\n');

  const tool: Anthropic.Messages.Tool = {
    name: 'emit_agent_def',
    description: 'Emit the full definition for this specialist agent as markdown fields.',
    input_schema: {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'One-line summary of what this agent is for.' },
        soul: { type: 'string', description: 'SOUL.md — the agent’s identity, voice, values, and disposition (who it is). 1-2 short paragraphs, on-brand with the company. No headers needed.' },
        agent_md: { type: 'string', description: 'AGENT.md — the operating instructions: a numbered step-by-step loop the agent follows, the exact OUTPUT FORMAT it must return, and its guardrails. This is how it actually runs. Concrete and prescriptive.' },
        skills: { type: 'string', description: 'SKILLS.md — the specific tactics, frameworks, checklists, and techniques this agent should apply, as markdown sections. Operational, not generic.' },
      },
      required: ['description', 'soul', 'agent_md', 'skills'],
    },
  };

  try {
    const client = new Anthropic({ apiKey, maxRetries: 4 });
    const res = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 3000,
      system:
        'You author agent definitions for a multi-agent marketing operations platform. Given a short intake about ONE ' +
        'specialist agent, produce a complete, operational SOUL / AGENT / SKILLS set in markdown. Be specific and ' +
        'prescriptive — the AGENT.md must contain a concrete step-by-step loop and an explicit output format the agent ' +
        'returns every run, so the owner can see exactly how it behaves and tune it. Align the agent to the company ' +
        'context when provided. Do not invent company facts. Always call emit_agent_def.',
      tools: [tool],
      tool_choice: { type: 'tool', name: 'emit_agent_def' },
      messages: [{
        role: 'user',
        content:
          `Agent id: ${id}\nAgent name: ${name}\nRole category: ${role}\n\n` +
          `Intake:\n${intake}\n\n` +
          (company ? `Company context to align with:\n${company}` : 'No company playbook yet — keep it broadly sensible for this role.'),
      }],
    });
    const use = res.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === 'emit_agent_def',
    );
    if (!use) return NextResponse.json({ error: 'Could not generate the agent — add more detail and retry.' }, { status: 502 });
    const out = use.input as { description?: string; soul?: string; agent_md?: string; skills?: string };
    return NextResponse.json({
      description: String(out.description ?? '').trim(),
      soul: String(out.soul ?? '').trim(),
      agent_md: String(out.agent_md ?? '').trim(),
      skills: String(out.skills ?? '').trim(),
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
