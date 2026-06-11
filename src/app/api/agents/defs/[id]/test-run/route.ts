import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { getAnthropicKey, NO_ANTHROPIC_KEY_MESSAGE } from '@/lib/anthropic-key';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

// POST /api/agents/defs/:id/test-run { soul, agent_md, skills, input, model? }
// Sandbox dry-run for Agent Studio: runs the DRAFT (unsaved) definition ONCE on a
// sample input so the owner can iterate before saving. Cheap + single-turn —
// NO tools, NO multi-turn loop, and it NEVER writes to agent_tasks or persists
// anything. The real spawn path (spawnSubAgent) is unchanged. Runs on the
// tenant's BYO Anthropic key.

interface Body { soul?: string; agent_md?: string; skills?: string; input?: string; model?: string }

export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  let body: Body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const input = String(body.input ?? '').trim();
  if (!input) {
    return NextResponse.json({ error: 'Enter a sample input to test-run the agent.' }, { status: 400 });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) return NextResponse.json({ error: NO_ANTHROPIC_KEY_MESSAGE }, { status: 400 });

  // Build the system prompt the same way the real loader concatenates the draft
  // files (see loadSubAgentSystemPrompt in src/lib/subagent.ts): soul / agent /
  // skills joined by the \n\n---\n\n separator, empties dropped.
  let system = [body.soul, body.agent_md, body.skills]
    .map((s) => String(s ?? '').trim())
    .filter(Boolean)
    .join('\n\n---\n\n');

  // Prepend the company playbook so the dry-run reflects how the agent really
  // runs (objectives, ICP, voice). Best-effort — never block the run on it.
  try {
    const { companyContextBlock } = await import('@/lib/company-playbook');
    const ctx = await companyContextBlock();
    if (ctx) system = `${ctx}\n${system}`;
  } catch { /* never block a dry-run on context load */ }

  if (!system.trim()) {
    return NextResponse.json({ error: 'Add a soul, instructions, or skills before test-running.' }, { status: 400 });
  }

  const model = String(body.model ?? '').trim() || 'claude-sonnet-4-6';

  try {
    const client = new Anthropic({ apiKey, maxRetries: 3 });
    const res = await client.messages.create({
      model,
      max_tokens: 1500,
      system,
      // NO tools — single-turn, cheap. This is a dry run, not a real task.
      messages: [{ role: 'user', content: input }],
    });
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (!text) {
      return NextResponse.json({ error: `Agent returned no text (stop_reason: ${res.stop_reason}).` }, { status: 502 });
    }
    return NextResponse.json({ ok: true, text });
  } catch (e) {
    const msg = e instanceof Anthropic.APIError ? `Anthropic ${e.status}: ${e.message}` : (e as Error).message;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
