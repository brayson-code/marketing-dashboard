// /api/salesops-admin/config — SESSION-authed read/write of the per-tenant SalesOps
// config (one row per tenant in salesops_config). This is the OWNER-facing write path
// the SalesOps page uses; the extension READS the same config via the token-authed
// GET /api/salesops/config (Engineer A). Keeping write here (session) and read there
// (token) means there is exactly ONE source of truth, cleanly split by auth model.
//
//   GET           → the tenant's config (created lazily with defaults if absent)  [owner|member]
//   POST { ...}   → upsert the editable fields                                    [owner|member]
//
// Holds NO secrets (Deepgram/Anthropic keys live in Connections, never here).

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId, jsonb } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { requireOwnerOrMember } from '@/lib/authz';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SalesopsConfigRow {
  tenant_id: string;
  persona: string | null;
  playbook: string | null;
  company_name: string | null;
  product_name: string | null;
  pricing: string | null;
  differentiators: string | null;
  objection_keywords: string[];
  suggestion_interval_ms: number;
  summary_enabled: boolean;
  summary_fields: string[];
  updated_at: Date | string;
}

const DEFAULT_SUMMARY_FIELDS = ['deal_temp', 'objections', 'pain_points', 'next_steps', 'action_items'];

function flagOff(): NextResponse | null {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  return null;
}

/** Read the tenant's config row, inserting a defaults row if none exists yet. Tenant-scoped. */
async function readOrCreateConfig(): Promise<SalesopsConfigRow> {
  const rows = (await sql()`
    SELECT tenant_id, persona, playbook, company_name, product_name, pricing,
           differentiators, objection_keywords, suggestion_interval_ms,
           summary_enabled, summary_fields, updated_at
    FROM salesops_config
    WHERE tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as SalesopsConfigRow[];
  if (rows[0]) return rows[0];

  const inserted = (await sql()`
    INSERT INTO salesops_config (tenant_id)
    VALUES (${tenantId()})
    ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
    RETURNING tenant_id, persona, playbook, company_name, product_name, pricing,
              differentiators, objection_keywords, suggestion_interval_ms,
              summary_enabled, summary_fields, updated_at
  `) as unknown as SalesopsConfigRow[];
  return inserted[0];
}

export async function GET() {
  const off = flagOff();
  if (off) return off;
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'No active workspace' }, { status: 403 });
  }
  const gate = await requireOwnerOrMember();
  if (gate) return gate;

  const config = await readOrCreateConfig();
  return NextResponse.json({ config });
}

/** Coerce an arbitrary value into a string[] of non-empty trimmed entries. */
function toStringArray(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof v === 'string') {
    // Accept a comma/newline-separated string from the form.
    return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
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

  // Read current first so an OMITTED field keeps its value (partial update). Tenant-scoped.
  const current = await readOrCreateConfig();

  // For each text field: present in body → trimmed string|null; absent → leave unchanged.
  const text = (k: string, existing: string | null): string | null => {
    if (!(k in body)) return existing;
    const v = body[k];
    const s = (v == null ? '' : String(v)).trim();
    return s.length ? s : null;
  };

  const objectionKeywords = toStringArray(body.objection_keywords);
  const summaryFieldsRaw = toStringArray(body.summary_fields);
  const summaryFields = summaryFieldsRaw && summaryFieldsRaw.length ? summaryFieldsRaw : undefined;

  let intervalMs: number | undefined;
  if (body.suggestion_interval_ms !== undefined) {
    const n = Number(body.suggestion_interval_ms);
    // Clamp to a sane 5s–120s window.
    intervalMs = Number.isFinite(n) ? Math.min(Math.max(Math.round(n), 5000), 120000) : undefined;
  }

  const summaryEnabled =
    body.summary_enabled === undefined ? undefined : Boolean(body.summary_enabled);

  // Merge incoming-or-existing in memory, then write the full row back. Tenant-scoped.
  const merged = {
    persona: text('persona', current.persona),
    playbook: text('playbook', current.playbook),
    company_name: text('company_name', current.company_name),
    product_name: text('product_name', current.product_name),
    pricing: text('pricing', current.pricing),
    differentiators: text('differentiators', current.differentiators),
    objection_keywords: objectionKeywords ?? current.objection_keywords ?? [],
    suggestion_interval_ms: intervalMs ?? current.suggestion_interval_ms ?? 15000,
    summary_enabled: summaryEnabled ?? current.summary_enabled ?? false,
    summary_fields: summaryFields ?? current.summary_fields ?? DEFAULT_SUMMARY_FIELDS,
  };

  const rows = (await sql()`
    UPDATE salesops_config SET
      persona = ${merged.persona},
      playbook = ${merged.playbook},
      company_name = ${merged.company_name},
      product_name = ${merged.product_name},
      pricing = ${merged.pricing},
      differentiators = ${merged.differentiators},
      objection_keywords = ${jsonb(merged.objection_keywords)},
      suggestion_interval_ms = ${merged.suggestion_interval_ms},
      summary_enabled = ${merged.summary_enabled},
      summary_fields = ${jsonb(merged.summary_fields)},
      updated_at = now()
    WHERE tenant_id = ${tenantId()}
    RETURNING tenant_id, persona, playbook, company_name, product_name, pricing,
              differentiators, objection_keywords, suggestion_interval_ms,
              summary_enabled, summary_fields, updated_at
  `) as unknown as SalesopsConfigRow[];

  return NextResponse.json({ config: rows[0] });
}
