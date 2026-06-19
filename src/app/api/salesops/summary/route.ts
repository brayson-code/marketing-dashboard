// POST /api/salesops/summary — generate the post-call CRM summary. The extension POSTs the
// full transcript on call end; we return JSON { summary } (format DEAL_TEMP:/OBJECTIONS:/
// PAIN_POINTS:/NEXT_STEPS:/ACTION_ITEMS:). The { summary } response shape is what the overlay
// renders — keep it.
//
// Ported verbatim from the standalone api/api/summary.js system prompt, but Claude runs on the
// TENANT'S BYO Anthropic key (getAnthropicKey), never a seeded key. After generating, we hand
// the result to the data pipeline (ingestCallSummary) to persist the call + drive KG / CRM
// follow-ups + an optional gated draft. The pipeline is best-effort — it never fails the
// summary returned to the rep.
//
// Auth: per-tenant SalesOps bearer token. CORS: permissive (token is the auth).

import Anthropic from '@anthropic-ai/sdk';
import { resolveSalesopsToken } from '@/lib/salesops/auth';
import { salesOpsCors, preflight } from '@/lib/salesops/cors';
import { getAnthropicKey } from '@/lib/anthropic-key';
import { enterTenant, runWithTenant, type TenantContext } from '@/lib/tenant';
import { ingestCallSummary } from '@/lib/salesops/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SummaryBody {
  transcript?: string;
  companyInfo?: string;
  fields?: string[];
  callId?: string;
  platform?: string;
  contactName?: string;
  contactEmail?: string;
  /** When true, the pipeline also drafts a follow-up email (through the existing
   *  autonomy gate — never an auto-send). The extension sets this from the tenant's
   *  summary/draft opt-in. Default off. */
  draftFollowup?: boolean;
}

const DEFAULT_FIELDS = ['deal_temp', 'objections', 'pain_points', 'next_steps', 'action_items'];

function buildSystemPrompt(companyInfo: string | undefined, activeFields: string[]): string {
  const fieldInstructions = [
    activeFields.includes('deal_temp') && 'DEAL_TEMP: [HOT / WARM / COLD] — one word only',
    activeFields.includes('objections') && 'OBJECTIONS:\n- [each objection the prospect raised, verbatim if possible]',
    activeFields.includes('pain_points') && 'PAIN_POINTS:\n- [specific pain points or frustrations mentioned]',
    activeFields.includes('next_steps') && 'NEXT_STEPS:\n- [any next steps, follow-ups, or commitments made]',
    activeFields.includes('action_items') && 'ACTION_ITEMS:\n- [specific things the rep needs to do after this call]',
  ]
    .filter(Boolean)
    .join('\n\n');

  return `You are a sales call analyst generating a concise CRM-ready summary.
${companyInfo ? `\nCompany context:\n${companyInfo}\n` : ''}
Return ONLY the following structured format — no intro, no explanation:

${fieldInstructions}

Rules:
- Be specific and use actual words from the conversation
- If a section has no relevant content, write "None identified"
- Keep each bullet to one sentence
- DEAL_TEMP: HOT = strong buying signals, WARM = interested but not ready, COLD = skeptical or not a fit`;
}

export function OPTIONS(req: Request): Response {
  return preflight(req);
}

export async function POST(req: Request): Promise<Response> {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return new Response('Not Found', { status: 404, headers: salesOpsCors(req) });
  }

  const cors = salesOpsCors(req);

  const ctx = await resolveSalesopsToken(req);
  if (!ctx) return new Response('Unauthorized', { status: 401, headers: cors });
  enterTenant(ctx);

  let body: SummaryBody;
  try {
    body = (await req.json()) as SummaryBody;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });
  }

  const transcript = (body.transcript ?? '').trim();
  if (!transcript) {
    return Response.json({ error: 'No transcript provided' }, { status: 400, headers: cors });
  }

  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return Response.json({ error: 'connect_anthropic' }, { status: 400, headers: cors });
  }

  const activeFields = Array.isArray(body.fields) && body.fields.length ? body.fields : DEFAULT_FIELDS;
  const system = buildSystemPrompt(body.companyInfo, activeFields);

  let summary: string;
  try {
    const client = new Anthropic({ apiKey, maxRetries: 1 });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 600,
      system,
      messages: [
        {
          role: 'user',
          content: `Generate a post-call summary for this sales call transcript:\n\n"${transcript}"`,
        },
      ],
    });
    summary = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
  } catch (e) {
    console.error('[salesops/summary]', (e as Error)?.message);
    return Response.json({ error: 'summary_failed' }, { status: 502, headers: cors });
  }

  // Persist + drive the data pipeline (KG/CRM/drafts). Best-effort: a pipeline failure
  // must NOT fail the summary the rep is waiting on.
  await finalizeBestEffort(ctx, {
    callId: body.callId,
    transcript,
    summary,
    platform: body.platform,
    contactName: body.contactName,
    contactEmail: body.contactEmail,
    draftFollowupEmail: body.draftFollowup,
  });

  // Response contract: { summary } — the overlay depends on this exact shape.
  return Response.json({ summary }, { headers: cors });
}

interface FinalizeArgs {
  callId?: string;
  transcript: string;
  summary: string;
  platform?: string;
  contactName?: string;
  contactEmail?: string;
  draftFollowupEmail?: boolean;
}

/**
 * Hand the call to the data pipeline (ingestCallSummary: persist + KG write + CRM
 * follow-ups + optional gated draft). Runs in the resolved tenant context and is
 * best-effort — ingestCallSummary guards every stage internally, but we still wrap so a
 * pipeline failure never throws into the summary the rep is waiting on.
 */
async function finalizeBestEffort(ctx: TenantContext, args: FinalizeArgs): Promise<void> {
  try {
    await runWithTenant(ctx, () => ingestCallSummary(args));
  } catch (e) {
    console.error('[salesops/summary] finalize', (e as Error)?.message);
  }
}
