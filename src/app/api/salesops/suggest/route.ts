// POST /api/salesops/suggest — the real-time sales-coach turn. The extension POSTs the
// rolling transcript every ~15s (or immediately on an objection keyword) and reads the
// response as a STREAMED text/plain body (raw Claude text deltas, format SAY:/TONE:/
// FOLLOW-UP:/QUESTIONS:). The draggable overlay regex-parses that text — DO NOT switch to
// SSE framing or the overlay breaks.
//
// Ported verbatim from the standalone api/api/suggest.js system prompt, but:
//   - Claude runs on the TENANT'S BYO Anthropic key (getAnthropicKey), never a seeded key.
//   - persona/playbook/company come from the REQUEST or the tenant's salesops_config
//     (request wins), instead of a server-side playbook.txt file.
//
// Auth: per-tenant SalesOps bearer token. CORS: permissive (token is the auth).

import Anthropic from '@anthropic-ai/sdk';
import { resolveSalesopsToken } from '@/lib/salesops/auth';
import { salesOpsCors, preflight } from '@/lib/salesops/cors';
import { getAnthropicKey } from '@/lib/anthropic-key';
import { sql } from '@/lib/db/client';
import { enterTenant, tenantId, runWithTenant, type TenantContext } from '@/lib/tenant';
import { recordSuggestTurn } from '@/lib/salesops/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface SuggestBody {
  transcript?: string;
  fullLength?: number;
  isObjection?: boolean;
  buyerPersona?: string;
  playbook?: string;
  companyName?: string;
  productName?: string;
  pricing?: string;
  differentiators?: string;
  callId?: string;
}

interface ConfigRow {
  persona: string | null;
  playbook: string | null;
  company_name: string | null;
  product_name: string | null;
  pricing: string | null;
  differentiators: string | null;
}

/** Load the tenant's stored config (tenant-scoped). Used as the fallback for any prompt
 *  field the request didn't supply. Returns null when no row exists. */
async function loadConfig(): Promise<ConfigRow | null> {
  const rows = (await sql()`
    SELECT persona, playbook, company_name, product_name, pricing, differentiators
    FROM salesops_config
    WHERE tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as ConfigRow[];
  return rows[0] ?? null;
}

/** Build the system prompt — verbatim structure from the standalone backend. */
function buildSystemPrompt(args: {
  playbook: string;
  buyerPersona: string;
  companyName: string;
  productName: string;
  pricing: string;
  differentiators: string;
  fullLength: number | undefined;
  isObjection: boolean;
}): string {
  const { playbook, buyerPersona, companyName, productName, pricing, differentiators, fullLength, isObjection } = args;

  const personaBlock = buyerPersona ? `## Buyer Persona\n${buyerPersona}` : '';

  const companyParts = [
    companyName && `Company: ${companyName}`,
    productName && `Product: ${productName}`,
    pricing && `Pricing: ${pricing}`,
    differentiators && `Key differentiators: ${differentiators}`,
  ].filter(Boolean);
  const companyBlock = companyParts.length ? `## Company Info\n${companyParts.join('\n')}` : '';

  const objectionBlock = isObjection
    ? '⚠️ OBJECTION DETECTED — Lead with a direct rebuttal before anything else.'
    : '';

  return `You are a real-time AI sales coach embedded in a live call.
Your job is to help the closer win this deal RIGHT NOW.

## Rules
- Be CONCISE. The rep needs to read your suggestion in under 3 seconds.
- Give a SPECIFIC response they can say verbatim, not generic advice.
- If an objection was detected, your SAY must be a direct rebuttal first.
- If the conversation is flowing well, suggest a closing or deepening move.
${objectionBlock}

## Output Format (use exactly this structure)
SAY: "[exact words to say — one or two sentences max]"
TONE: [one word: empathetic / confident / curious / urgent]
FOLLOW-UP: "[one question to keep control of the conversation]"
QUESTIONS:
• [relevant discovery or closing question]
• [another question they could ask]

## Playbook
${playbook}

${personaBlock}

${companyBlock}

## Context
- Word ${fullLength || '?'} of the conversation.
- Focus on the last 1-2 sentences of the transcript.`;
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

  let body: SuggestBody;
  try {
    body = (await req.json()) as SuggestBody;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400, headers: cors });
  }

  const transcript = (body.transcript ?? '').trim();
  if (!transcript) {
    return Response.json({ error: 'No transcript provided' }, { status: 400, headers: cors });
  }

  // BYO key — client workspaces must connect their own Anthropic key.
  const apiKey = await getAnthropicKey();
  if (!apiKey) {
    return Response.json({ error: 'connect_anthropic' }, { status: 400, headers: cors });
  }

  // Merge request (wins) over the tenant's stored config.
  const cfg = await loadConfig().catch(() => null);
  const playbook =
    (body.playbook?.trim() || cfg?.playbook?.trim()) ||
    'No playbook loaded. Provide general sales coaching.';
  const buyerPersona = body.buyerPersona?.trim() || cfg?.persona?.trim() || '';
  const companyName = body.companyName?.trim() || cfg?.company_name?.trim() || '';
  const productName = body.productName?.trim() || cfg?.product_name?.trim() || '';
  const pricing = body.pricing?.trim() || cfg?.pricing?.trim() || '';
  const differentiators = body.differentiators?.trim() || cfg?.differentiators?.trim() || '';

  const system = buildSystemPrompt({
    playbook,
    buyerPersona,
    companyName,
    productName,
    pricing,
    differentiators,
    fullLength: body.fullLength,
    isObjection: !!body.isObjection,
  });

  const client = new Anthropic({ apiKey, maxRetries: 1 });

  let stream: Awaited<ReturnType<typeof client.messages.stream>>;
  try {
    stream = await client.messages.stream({
      model: 'claude-sonnet-4-5',
      max_tokens: 350,
      system,
      messages: [
        {
          role: 'user',
          content: `Here's what's being said on the call right now:\n\n"${transcript}"\n\nWhat should I say next?`,
        },
      ],
    });
  } catch (e) {
    // Never surface a raw provider error (billing/rate-limit) — the overlay just needs a body.
    console.error('[salesops/suggest]', (e as Error)?.message);
    return Response.json({ error: 'suggest_failed' }, { status: 502, headers: cors });
  }

  // Capture tenant + body so the best-effort pipeline call runs in the right context
  // after the stream finishes (we're past the request's sync frame by then).
  const pipelineCtx = ctx;
  const callId = body.callId;
  const isObjection = !!body.isObjection;

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      let assembled = '';
      try {
        for await (const ev of stream) {
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            assembled += ev.delta.text;
            controller.enqueue(encoder.encode(ev.delta.text));
          }
        }
      } catch (e) {
        // Mid-stream provider error — close cleanly with whatever we have; the overlay
        // renders partial text rather than hanging.
        console.error('[salesops/suggest] stream', (e as Error)?.message);
      } finally {
        controller.close();
      }

      // Best-effort pipeline turn (D's helper). Never blocks/affects the stream; tolerant
      // of the helper not existing yet (Engineer D owns pipeline.ts).
      void recordTurnBestEffort(pipelineCtx, {
        callId,
        transcript,
        suggestionText: assembled,
        isObjection,
      });
    },
  });

  return new Response(readable, {
    headers: (() => {
      cors.set('Content-Type', 'text/plain; charset=utf-8');
      cors.set('Cache-Control', 'no-store');
      return cors;
    })(),
  });
}

/**
 * Forward the completed turn to the data pipeline (recordSuggestTurn in pipeline.ts).
 * Runs inside the resolved tenant context and never throws into the request — a pipeline
 * failure must never affect the stream the rep is reading.
 */
async function recordTurnBestEffort(
  ctx: TenantContext,
  turn: { callId?: string; transcript: string; suggestionText: string; isObjection: boolean },
): Promise<void> {
  try {
    await runWithTenant(ctx, () => recordSuggestTurn(turn));
  } catch (e) {
    console.error('[salesops/suggest] pipeline', (e as Error)?.message);
  }
}
