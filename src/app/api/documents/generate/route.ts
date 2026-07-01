// /api/documents/generate — SESSION-authed SOP Generator: run the guided Q&A answers through
// the tenant's BYO Anthropic key and return a DRAFT SOP (title + markdown) for REVIEW. This
// route does NOT write anything — generation is read-only. The UI shows the draft, then SAVES
// it via the existing POST /api/documents with type:"sop". Same auth model / preamble as the
// salesops-admin generate route (tenant-scoped + owner|member; VA blocked from config).
//
//   POST { ...SOPAnswers } → 200 { draft: { title, markdown } }   [owner|member]
//
// BYO key contract: generateSOP() throws Error('connect_anthropic') when the tenant has no
// Anthropic key connected → we return the EXACT 400 {error:'connect_anthropic'} the page keys
// off. Any other failure → 502 {error:'generate_failed'} so we never leak a raw provider error
// (billing/rate-limit/parse).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import { generateSOP, CONNECT_ANTHROPIC, type SOPAnswers } from '@/lib/sop-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generation is heavier than a single chat turn — give it room.
export const maxDuration = 60;

/** Trim a value to a string (empty when absent/blank). */
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  // Build the SOPAnswers shape from the wizard form. title + purpose are required (an SOP is
  // meaningless without them); the rest are free-text aids.
  const answers: SOPAnswers = {
    title: str(body.title),
    purpose: str(body.purpose),
    scope: str(body.scope) || undefined,
    audience: str(body.audience) || undefined,
    steps_outline: str(body.steps_outline) || undefined,
    tools: str(body.tools) || undefined,
    notes: str(body.notes) || undefined,
  };

  const missing = (['title', 'purpose'] as const).filter((k) => !answers[k]);
  if (missing.length) {
    return NextResponse.json({ error: 'missing_fields', fields: missing }, { status: 400 });
  }

  try {
    const draft = await generateSOP(answers);
    return NextResponse.json({ draft });
  } catch (e) {
    // BYO-key-missing is the one error we surface verbatim (the page renders a
    // "Connect your Anthropic key" CTA off this exact code).
    if ((e as Error)?.message === CONNECT_ANTHROPIC) {
      return NextResponse.json({ error: 'connect_anthropic' }, { status: 400 });
    }
    // Everything else (provider/parse/rate-limit) → opaque 502; never leak the cause.
    return NextResponse.json({ error: 'generate_failed' }, { status: 502 });
  }
}
