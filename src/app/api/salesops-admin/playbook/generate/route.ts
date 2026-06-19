// /api/salesops-admin/playbook/generate — SESSION-authed Playbook Studio (Phase 1) step 1:
// run the guided Q&A wizard answers through the tenant's BYO Anthropic key and return a
// DRAFT playbook for REVIEW. This route does NOT write anything — generation is read-only.
// The owner reviews/edits the draft in the UI, then POSTs it to .../playbook/apply to save +
// activate it. Same auth model as the other salesops-admin routes (session + owner|member;
// VA blocked from config), same SALESOPS_ENABLED kill switch.
//
//   POST { ...PlaybookAnswers } → 200 { draft: PlaybookContent }   [owner|member]
//
// BYO key contract: generatePlaybook() throws Error('connect_anthropic') when the tenant has
// no Anthropic key connected → we return the EXACT 400 {error:'connect_anthropic'} the page
// keys off (same contract as /api/salesops/summary + /suggest). Any other failure → 502
// {error:'generate_failed'} so we never leak a raw provider error (billing/rate-limit/parse).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import {
  generatePlaybook,
  CONNECT_ANTHROPIC,
  type PlaybookAnswers,
} from '@/lib/salesops/playbook-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Generation is heavier than a single suggest turn — give it room.
export const maxDuration = 60;

/** SALESOPS_ENABLED off → 404 (feature invisible). Mirrors the other salesops-admin routes. */
function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

/** Trim a value to a string (empty when absent/blank). */
function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

export async function POST(request: Request) {
  const off = flagOff();
  if (off) return off;
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

  // Build the PlaybookAnswers shape from the wizard form. The core selling facts are
  // required (the playbook is meaningless without them); the rest are free-text aids.
  const answers: PlaybookAnswers = {
    company_name: str(body.company_name),
    product_name: str(body.product_name),
    buyer_persona: str(body.buyer_persona),
    pricing: str(body.pricing),
    differentiators: str(body.differentiators),
    sales_motion: str(body.sales_motion),
    methodology: str(body.methodology) || undefined,
    common_objections: str(body.common_objections),
    desired_tone: str(body.desired_tone),
    call_goal: str(body.call_goal),
  };

  const missing = (['company_name', 'product_name', 'buyer_persona'] as const).filter(
    (k) => !answers[k],
  );
  if (missing.length) {
    return NextResponse.json(
      { error: 'missing_fields', fields: missing },
      { status: 400 },
    );
  }

  try {
    const draft = await generatePlaybook(answers);
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
