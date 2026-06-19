// /api/salesops-admin/playbook/apply — SESSION-authed Playbook Studio (Phase 1) step 2:
// take the REVIEWED (possibly edited) draft and make it the tenant's ACTIVE playbook.
// NON-DESTRUCTIVE by design — Apply only INSERTs a NEW salesops_playbooks row and flips
// is_active; it NEVER updates/deletes a prior playbook, so every past variant stays in the
// table for history + later split-testing. Same auth as the other salesops-admin routes
// (session + owner|member; VA blocked), same SALESOPS_ENABLED kill switch.
//
//   POST { name, content: PlaybookContent, inputs?: PlaybookAnswers }
//     → 200 { playbook: { id, name, is_active } }                     [owner|member]
//
// Two writes, both tenant-scoped, sequenced so the co-pilot is correct the instant Apply
// returns:
//   (1) INSERT the new playbook (is_active=false), then inside sql().begin() clear the old
//       active row and set THIS one active — the partial-unique-active index guarantees at
//       most one active per tenant, and the txn means the swap is atomic (never two-active
//       and never zero-active mid-flight).
//   (2) MIRROR the structured fields into salesops_config (persona/playbook/company_name/
//       product_name/pricing/differentiators + objection_keywords). /api/salesops/suggest's
//       loadConfig() reads exactly those from salesops_config, so the live coach uses the new
//       playbook with ZERO changes to suggest/route.ts. We leave suggestion_interval_ms /
//       summary_* untouched (those stay owned by the Configure form).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId, jsonb } from '@/lib/db/client';
import { NO_TENANT_ID, currentUserId } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';
import type { PlaybookContent } from '@/lib/salesops/playbook-gen';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v.trim();
  if (v == null) return '';
  return String(v).trim();
}

function strArray(v: unknown, cap: number): string[] {
  let arr: unknown[];
  if (Array.isArray(v)) arr = v;
  else if (typeof v === 'string') arr = v.split(/[,\n]/);
  else return [];
  return arr.map((x) => str(x)).filter(Boolean).slice(0, cap);
}

interface ObjectionScript {
  objection: string;
  response: string;
}

function objectionScripts(v: unknown, cap: number): ObjectionScript[] {
  if (!Array.isArray(v)) return [];
  const out: ObjectionScript[] = [];
  for (const item of v) {
    if (item && typeof item === 'object') {
      const objection = str((item as Record<string, unknown>).objection);
      const response = str((item as Record<string, unknown>).response);
      if (objection || response) out.push({ objection, response });
    }
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Coerce the (UI-edited) draft into a clean PlaybookContent so we snapshot a well-typed row
 * and mirror clean values into salesops_config. The UI may have edited any field, so we
 * re-normalize rather than trust the body verbatim.
 */
function normalizeContent(raw: unknown): PlaybookContent {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    persona: str(r.persona),
    company_name: str(r.company_name),
    product_name: str(r.product_name),
    pricing: str(r.pricing),
    differentiators: str(r.differentiators),
    objection_keywords: strArray(r.objection_keywords, 24).map((k) => k.toLowerCase()),
    opener: str(r.opener),
    discovery_questions: strArray(r.discovery_questions, 12),
    value_props: strArray(r.value_props, 10),
    objection_handling: objectionScripts(r.objection_handling, 16),
    closing: str(r.closing),
    playbook_narrative: str(r.playbook_narrative),
  };
}

interface SalesopsConfigExists {
  tenant_id: string;
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

  const name = str(body.name).slice(0, 120);
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const content = normalizeContent(body.content);
  if (!content.playbook_narrative) {
    // The narrative is what the live coach reads — refuse to activate an empty playbook.
    return NextResponse.json({ error: 'empty_playbook' }, { status: 400 });
  }
  // inputs holds the wizard answers for Phase-1 provenance; future phases extend it with
  // cited sources. Stored as-is (jsonb), defaulting to {} when absent.
  const inputs =
    body.inputs && typeof body.inputs === 'object' ? (body.inputs as Record<string, unknown>) : {};

  const uid = currentUserId();
  const s = sql();

  // (1)+(2) INSERT the new playbook AND flip active in ONE transaction, so a partial failure
  // can't leave an orphan row. We never UPDATE/DELETE an existing playbook → the prior active
  // row stays for history/split-testing. Ordering matters: insert inactive (excluded from the
  // partial-unique-active index), clear the prior active, then set THIS one active — so the
  // index never sees two-active. All queries tenant-scoped.
  const newRow = await s.begin(async (tx) => {
    const insertedRows = (await tx`
      INSERT INTO salesops_playbooks (tenant_id, name, content, inputs, source, is_active, created_by)
      VALUES (${tenantId()}, ${name}, ${jsonb(content)}, ${jsonb(inputs)}, 'wizard', false, ${uid})
      RETURNING id, name, is_active
    `) as unknown as Array<{ id: string; name: string; is_active: boolean }>;
    const row = insertedRows[0];
    await tx`
      UPDATE salesops_playbooks
      SET is_active = false, updated_at = now()
      WHERE tenant_id = ${tenantId()} AND is_active AND id <> ${row.id}
    `;
    await tx`
      UPDATE salesops_playbooks
      SET is_active = true, updated_at = now()
      WHERE id = ${row.id} AND tenant_id = ${tenantId()}
    `;
    return row;
  });

  // (3) MIRROR the structured fields into salesops_config so the token-authed /suggest route
  // (loadConfig) uses the new playbook with no route change. Ensure the config row exists
  // first (read-or-create, same pattern as the config route), then update only the mirrored
  // fields — leaving suggestion_interval_ms / summary_* (owned by the Configure form) intact.
  const existing = (await s`
    SELECT tenant_id FROM salesops_config WHERE tenant_id = ${tenantId()} LIMIT 1
  `) as unknown as SalesopsConfigExists[];
  if (!existing[0]) {
    await s`
      INSERT INTO salesops_config (tenant_id)
      VALUES (${tenantId()})
      ON CONFLICT (tenant_id) DO NOTHING
    `;
  }
  await s`
    UPDATE salesops_config SET
      persona = ${content.persona || null},
      playbook = ${content.playbook_narrative || null},
      company_name = ${content.company_name || null},
      product_name = ${content.product_name || null},
      pricing = ${content.pricing || null},
      differentiators = ${content.differentiators || null},
      objection_keywords = ${jsonb(content.objection_keywords)},
      updated_at = now()
    WHERE tenant_id = ${tenantId()}
  `;

  return NextResponse.json({
    playbook: { id: newRow.id, name: newRow.name, is_active: true },
  });
}
