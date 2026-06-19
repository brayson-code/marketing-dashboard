// GET /api/salesops/config — return the authenticated tenant's SalesOps config so the
// extension can hydrate its prompt context (persona/playbook/company/product/pricing/
// differentiators), objection keywords, suggestion cadence, and summary toggles.
//
// This is GET-only for the extension. The WRITE path lives on the session-authed owner
// page (/api/salesops-admin/config) — there's a single source of truth for the config,
// and the extension only ever READS it. The row holds NO secrets (keys never live here).
//
// Auth: per-tenant SalesOps bearer token. CORS: permissive (token is the auth).

import { resolveSalesopsToken } from '@/lib/salesops/auth';
import { salesOpsCors, preflight } from '@/lib/salesops/cors';
import { sql } from '@/lib/db/client';
import { enterTenant, tenantId } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface SalesopsConfigRow {
  persona: string | null;
  playbook: string | null;
  company_name: string | null;
  product_name: string | null;
  pricing: string | null;
  differentiators: string | null;
  objection_keywords: unknown;
  suggestion_interval_ms: number;
  summary_enabled: boolean;
  summary_fields: unknown;
  updated_at: Date | string;
}

const DEFAULT_SUMMARY_FIELDS = ['deal_temp', 'objections', 'pain_points', 'next_steps', 'action_items'];

/** The default-shaped config returned when a tenant has no row yet. Mirrors the 0049
 *  column defaults so the extension behaves identically before the owner saves anything. */
function defaultConfig() {
  return {
    persona: null,
    playbook: null,
    company_name: null,
    product_name: null,
    pricing: null,
    differentiators: null,
    objection_keywords: [] as unknown[],
    suggestion_interval_ms: 15000,
    summary_enabled: false,
    summary_fields: DEFAULT_SUMMARY_FIELDS,
  };
}

export function OPTIONS(req: Request): Response {
  return preflight(req);
}

export async function GET(req: Request): Promise<Response> {
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return new Response('Not Found', { status: 404, headers: salesOpsCors(req) });
  }

  const ctx = await resolveSalesopsToken(req);
  if (!ctx) return new Response('Unauthorized', { status: 401, headers: salesOpsCors(req) });
  enterTenant(ctx);

  // Tenant-scoped read — sql() bypasses RLS, so the tenant_id filter is mandatory.
  const rows = (await sql()`
    SELECT persona, playbook, company_name, product_name, pricing, differentiators,
           objection_keywords, suggestion_interval_ms, summary_enabled, summary_fields, updated_at
    FROM salesops_config
    WHERE tenant_id = ${tenantId()}
    LIMIT 1
  `) as unknown as SalesopsConfigRow[];

  const row = rows[0];
  if (!row) {
    // No row yet — return defaults (don't write here; the owner's admin save creates it).
    return Response.json(defaultConfig(), { headers: salesOpsCors(req) });
  }

  return Response.json(
    {
      persona: row.persona,
      playbook: row.playbook,
      company_name: row.company_name,
      product_name: row.product_name,
      pricing: row.pricing,
      differentiators: row.differentiators,
      objection_keywords: Array.isArray(row.objection_keywords) ? row.objection_keywords : [],
      suggestion_interval_ms: row.suggestion_interval_ms ?? 15000,
      summary_enabled: !!row.summary_enabled,
      summary_fields: Array.isArray(row.summary_fields) ? row.summary_fields : DEFAULT_SUMMARY_FIELDS,
    },
    { headers: salesOpsCors(req) },
  );
}
